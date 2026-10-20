import { ipcMain } from 'electron';
import { OverlayWindowManager } from '../overlay/overlay-window-manager';
import { AppWindowManager } from '../windows/app-window-manager';

// ============================================
// SPACES BRIDGE
// ============================================
//
// The Spaces feature lives entirely inside the **app-window** renderer:
// every Space, its attached project folder, and the full message history
// are persisted to the app-window's localStorage and reconstructed via the
// `loadSpaces` / `saveSpacesDebounced` helpers in
// `app-ui/src/components/projects/types.ts`.
//
// The overlay window is a separate BrowserWindow with its *own* origin and
// therefore its *own* localStorage — it has no direct visibility into the
// user's Spaces. To support the overlay's "Attach Space" affordance we
// route the shared state through the main process:
//
//   App window  ──spaces:publish-snapshot──▶  Main (in-memory cache)
//                                                │
//   Overlay ◀──spaces:list (invoke)──────────────┘
//   Overlay ──spaces:append-messages────▶  Main ──spaces:apply-append─▶ App window
//
// The cache is a *projection* (id, name, projects[…]) — the overlay does
// not need to see persisted message history to render the picker, and
// shipping every turn over the structured-clone bridge on every keystroke
// would be wasteful. Messages flow back the opposite direction: the
// overlay accumulates a turn locally, then sends just that turn (user +
// assistant) to the app window which appends to its `space.messages`
// array (triggering the existing 250ms debounced save).
//
// IPC Contract:
//   Renderer → Main (send):
//     spaces:publish-snapshot   — App window publishes its current spaces list
//     spaces:append-messages    — Overlay appends 1+ messages to a specific space
//
//   Renderer → Main (invoke):
//     spaces:list               — Returns cached snapshot
//
//   Main → App Window (send):
//     spaces:apply-append       — Apply a list of messages to a specific space
// ============================================

export interface SpaceSummaryProjection {
  id: string;
  name: string;
  projects: Array<{
    projectId: string;
    name: string;
    localPath: string;
    branch?: string;
  }>;
  lastUsedAt: number;
}

export interface SpaceMessageProjection {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  groupId?: string;
  versionIndex?: number;
}

let cachedSpaces: SpaceSummaryProjection[] = [];
let _appWindowManager: AppWindowManager | null = null;

/**
 * Returns the current cached space summaries. Used by other IPC layers
 * (e.g. overlay handlers) that may want to know whether the overlay is
 * pointing at a real, still-existing space.
 */
export function getCachedSpaces(): SpaceSummaryProjection[] {
  return cachedSpaces;
}

export function findCachedSpace(spaceId: string): SpaceSummaryProjection | null {
  return cachedSpaces.find((s) => s.id === spaceId) ?? null;
}

export function registerSpacesBridgeHandlers(
  _overlayManager: OverlayWindowManager,
  appWindowManager: AppWindowManager,
): void {
  _appWindowManager = appWindowManager;

  // ── App window publishes its current spaces snapshot ─────────────────
  // Sent on:
  //   - Initial mount of ProjectsView (with the freshly-loaded list)
  //   - Whenever the spaces React state changes (debounced by a 250ms
  //     effect upstream → no need to throttle here too)
  //   - When the user signs out / switches accounts (an empty array is
  //     pushed so the overlay picker reflects the new identity)
  ipcMain.on('spaces:publish-snapshot', (_event, spaces: SpaceSummaryProjection[]) => {
    if (!Array.isArray(spaces)) {
      cachedSpaces = [];
      return;
    }
    // Defensive: trim to the lightweight projection in case the renderer
    // accidentally passes the full Space objects (with messages) — keeps
    // the cached payload small and avoids leaking message history.
    cachedSpaces = spaces.map((s) => ({
      id: String(s.id),
      name: String(s.name ?? ''),
      projects: Array.isArray(s.projects)
        ? s.projects.map((p) => ({
            projectId: String(p.projectId),
            name: String(p.name ?? ''),
            localPath: String(p.localPath ?? ''),
            branch: p.branch ? String(p.branch) : undefined,
          }))
        : [],
      lastUsedAt: typeof s.lastUsedAt === 'number' ? s.lastUsedAt : Date.now(),
    }));
  });

  // ── Overlay (or any other renderer) requests the current snapshot ────
  ipcMain.handle('spaces:list', async () => {
    return cachedSpaces;
  });

  // ── Overlay appends messages to a specific space ─────────────────────
  // The overlay completes a turn (user prompt + streamed assistant reply)
  // and then asks main to apply it to the named space. Main forwards the
  // mutation to the app window which actually owns persistence.
  //
  // We deliberately do NOT update the cached projection here: messages
  // aren't part of the cache (see top-of-file comment). The next snapshot
  // publish from the app window will cover any drift.
  ipcMain.on(
    'spaces:append-messages',
    (_event, payload: { spaceId: string; messages: SpaceMessageProjection[] }) => {
      try {
        if (!payload?.spaceId || !Array.isArray(payload.messages)) return;
        if (payload.messages.length === 0) return;

        // Sanity-check the space still exists in the cache. A user may
        // have deleted the space between attaching it in the overlay and
        // sending a turn — in which case we just drop the append (the
        // overlay's own UI is unaffected; only the cross-window sync
        // becomes a no-op).
        const exists = cachedSpaces.some((s) => s.id === payload.spaceId);
        if (!exists) {
          console.warn(`[SpacesBridge] append-messages: space ${payload.spaceId} not in cache, dropping`);
          return;
        }

        if (!_appWindowManager) return;
        _appWindowManager.send('spaces:apply-append', {
          spaceId: payload.spaceId,
          messages: payload.messages,
        });
      } catch (err) {
        console.error('[SpacesBridge] append messages failed:', err);
      }
    },
  );
}

export function clearSpacesCache(): void {
  cachedSpaces = [];
}

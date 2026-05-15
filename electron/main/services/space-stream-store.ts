/**
 * In-memory buffer for active Space streaming sessions.
 *
 * Keyed by spaceId. At most one active stream per space at any time.
 * A stream entry lives from the moment `optimizeStream` starts until
 * the stream completes/errors, plus a short linger window so a fast
 * re-navigate to the same space still sees the final content.
 *
 * The store is the single source of truth that lets SpaceWorkspace
 * resume displaying partial content when it remounts mid-stream, and
 * prevents the previous mount's completion handler from double-saving
 * a message after the new mount has taken over rendering.
 *
 * Lifecycle:
 *   register(spaceId)           — before optimizeStream starts
 *   update(spaceId, accumulated) — on every chunk
 *   complete(spaceId)           — after the final chunk; entry lingers briefly
 *   error(spaceId)              — stream failed; entry removed immediately
 *   get(spaceId)                — query current state (also marks taken-over)
 *   markTakenOver(spaceId)      — called when a new mount resumes the stream
 */

const TTL_MS = 30 * 60 * 1000;          // 30-minute hard expiry
const LINGER_AFTER_COMPLETE_MS = 10_000; // keep entry briefly after completion

interface SpaceStreamEntry {
  spaceId: string;
  accumulated: string;
  isComplete: boolean;
  /** True once a new SpaceWorkspace mount has queried and resumed this stream.
   *  The previous mount's self-removing completion handler reads this flag to
   *  decide whether to skip its localStorage save (avoiding a double-write). */
  takenOver: boolean;
  startedAt: number;
  expiresAt: number;
}

export interface SpaceStreamState {
  spaceId: string;
  accumulated: string;
  isComplete: boolean;
  takenOver: boolean;
  startedAt: number;
}

const store = new Map<string, SpaceStreamEntry>();

export const spaceStreamStore = {
  register(spaceId: string): void {
    store.set(spaceId, {
      spaceId,
      accumulated: '',
      isComplete: false,
      takenOver: false,
      startedAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
    });
  },

  update(spaceId: string, accumulated: string): void {
    const entry = store.get(spaceId);
    if (!entry) return;
    entry.accumulated = accumulated;
    entry.expiresAt = Date.now() + TTL_MS;
  },

  complete(spaceId: string): void {
    const entry = store.get(spaceId);
    if (!entry) return;
    entry.isComplete = true;
    setTimeout(() => store.delete(spaceId), LINGER_AFTER_COMPLETE_MS);
  },

  error(spaceId: string): void {
    store.delete(spaceId);
  },

  get(spaceId: string): SpaceStreamState | null {
    const entry = store.get(spaceId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(spaceId);
      return null;
    }
    return {
      spaceId: entry.spaceId,
      accumulated: entry.accumulated,
      isComplete: entry.isComplete,
      takenOver: entry.takenOver,
      startedAt: entry.startedAt,
    };
  },

  /**
   * Called when a new SpaceWorkspace mount has detected and resumed an
   * active stream. Signals the still-alive old-mount completion handler
   * that it should skip its localStorage persistence path.
   */
  markTakenOver(spaceId: string): void {
    const entry = store.get(spaceId);
    if (entry) entry.takenOver = true;
  },

  /** Remove a single entry, or all entries when called without args. */
  clear(spaceId?: string): void {
    if (spaceId) {
      store.delete(spaceId);
    } else {
      store.clear();
    }
  },
};

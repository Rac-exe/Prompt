import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as Sentry from "@sentry/react";
import { SpacesList } from "./SpacesList";
import { SpaceWorkspace } from "./SpaceWorkspace";
import { Sparkle, Folder, Lightning, Eye, Database } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { Space } from "./types";
import { loadSpaces, saveSpacesDebounced, flushSpacesSaves } from "./types";
import { useAuth } from "@/context/AuthContext";

interface ProjectsViewProps {
  /** Open the prompt-library Save modal with a given content string.
   *  Replaces the legacy `onSendToChat` which silently navigated the user
   *  to a brand-new chat — that was filed as a bug since users expect Save
   *  to mean "save to my prompt library" (the same as in the chat view). */
  onSaveMessage?: (content: string) => void;
}

export const ProjectsView = ({ onSaveMessage }: ProjectsViewProps = {}) => {
  const { user } = useAuth();
  const userId = user?.profile?.id ?? null;

  const [spaces, setSpaces] = useState<Space[]>(() => loadSpaces(userId));
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  // Map of projectId → live index status. Lives at this level (not in
  // SpacesList) so that a single live broadcast updates both the card grid
  // AND the workspace simultaneously. Without this, the card kept showing
  // its persisted (often stale) status while the open workspace showed the
  // real one — confusing the user into thinking the dot was random.
  const [projectStatusMap, setProjectStatusMap] = useState<Record<string, string>>({});

  const api = (window as any).electronAPI?.project;

  // Reload spaces whenever the signed-in user changes (login, logout,
  // account switch). Without this, React state from the previous account
  // would leak into the next one. Also flush any pending writes so we don't
  // overwrite the new user's storage with the previous user's payload, and
  // re-allow the per-session ensureFresh side effect to fire for the new user.
  useEffect(() => {
    flushSpacesSaves();
    setSpaces(loadSpaces(userId));
    setActiveSpaceId(null);
    ensureFreshFiredRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    saveSpacesDebounced(spaces, userId);
  }, [spaces, userId]);

  // ── Auto-reindex on app open ────────────────────────────
  // When the user explicitly quits from the system tray and relaunches the
  // app, the chokidar watchers were torn down with the process — meaning any
  // file edits made while the app was closed are not in the index. We ask
  // the main process to (a) restart watchers and (b) trigger a full reindex
  // for every project whose backend status is `stale`/`indexing`/`error`.
  //
  // CRITICAL: this must fire ONLY for projects that existed BEFORE this
  // session started — never for projects the user adds during the session.
  // Otherwise newly-added folders get a redundant reindex queued on top of
  // the initial scan, briefly flashing "stale" in the UI and wasting work.
  //
  // We read directly from `loadSpaces(userId)` (the persisted snapshot) so
  // this effect doesn't depend on React's `spaces` state — adding a folder
  // mutates `spaces` but doesn't re-trigger ensure-fresh.
  const ensureFreshFiredRef = useRef<boolean>(false);
  const ensureFreshUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!api?.ensureFresh || !userId) return;
    if (ensureFreshFiredRef.current && ensureFreshUserRef.current === userId) return;

    ensureFreshFiredRef.current = true;
    ensureFreshUserRef.current = userId;

    const persisted = loadSpaces(userId);
    const projectsToCheck = persisted.flatMap((s) =>
      s.projects
        .filter((p) => p.projectId && p.localPath)
        .map((p) => ({ projectId: p.projectId, localPath: p.localPath })),
    );

    if (projectsToCheck.length === 0) return;

    api
      .ensureFresh(projectsToCheck)
      .catch((err: unknown) => {
        Sentry.captureException(err, { tags: { component: "projects-view", op: "ensure-fresh" } });
      });
  }, [api, userId]);

  // ── Live status map for every project across every space ─────────────
  // Powers the per-card status dot in SpacesList. We fetch once on mount
  // (and whenever the set of projectIds changes) and then rely on the
  // global `project:status-update` broadcast to keep things fresh — the
  // exact same broadcast SpaceWorkspace listens to.
  const projectIdsKey = useMemo(
    () => spaces.flatMap((s) => s.projects.map((p) => p.projectId)).sort().join(","),
    [spaces],
  );
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const ids = projectIdsKey ? projectIdsKey.split(",") : [];
    if (ids.length === 0) {
      setProjectStatusMap({});
      return;
    }
    (async () => {
      const next: Record<string, string> = {};
      for (const id of ids) {
        try {
          const s = await api.status(id);
          if (s?.index_status) next[id] = s.index_status;
        } catch {
          // missing project (e.g. removed from Supabase) — leave unset so
          // the card falls back to the persisted indexStatus or "unknown".
        }
      }
      if (cancelled) return;
      // ── Merge guard ─────────────────────────────────────────────────
      // CRITICAL: never overwrite an `indexing` status with a `stale`/
      // `error` status from a fetch. When the user just attached a folder
      // we optimistically set `indexing` AND the main process emits an
      // `indexing` broadcast — but the backend DB row is created with
      // `stale` and stays that way until the worker picks up the queued
      // scan (seconds later). A naïve `{ ...prev, ...next }` would happily
      // clobber the optimistic value with the DB's stale one, flipping
      // the dot from amber → red even though indexing is still in flight.
      // Broadcasts (which are the source of truth for transitions) will
      // later flip us back to `ready`.
      setProjectStatusMap((prev) => {
        const merged = { ...prev };
        for (const [id, fresh] of Object.entries(next)) {
          const existing = prev[id];
          if (!existing) {
            merged[id] = fresh;
          } else if (existing === "indexing" && (fresh === "stale" || fresh === "error")) {
            // Preserve in-flight indexing; trust upcoming broadcast.
            continue;
          } else {
            merged[id] = fresh;
          }
        }
        return merged;
      });
    })();
    return () => { cancelled = true; };
  }, [api, projectIdsKey]);

  useEffect(() => {
    if (!api?.onStatusUpdate) return;
    const unsub = api.onStatusUpdate((data: any) => {
      if (!data?.projectId || !data?.status) return;
      setProjectStatusMap((prev) =>
        prev[data.projectId] === data.status ? prev : { ...prev, [data.projectId]: data.status },
      );
    });
    return () => unsub?.();
  }, [api]);

  const handleCreateSpace = useCallback((name: string) => {
    const newSpace: Space = {
      id: crypto.randomUUID(),
      name,
      projects: [],
      messages: [],
      projectMode: true,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    setSpaces((prev) => [...prev, newSpace]);
    setActiveSpaceId(newSpace.id);
  }, []);

  const handleRenameSpace = useCallback((id: string, name: string) => {
    setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }, []);

  // Deleting a space must also tear down every project it contained — both
  // locally (chokidar watcher) and on the backend (Supabase project + cascade-
  // deleted code_chunks/code_relationships rows). Without this, removing a
  // space silently left an orphan project in the user's account.
  const handleDeleteSpace = useCallback(
    (id: string) => {
      setSpaces((prev) => {
        const target = prev.find((s) => s.id === id);
        if (target && api?.remove) {
          for (const proj of target.projects) {
            api.remove(proj.projectId).catch((err: unknown) => {
              Sentry.captureException(err, { tags: { component: "projects-view", op: "delete-space-project" }, extra: { projectId: proj.projectId } });
            });
          }
        }
        return prev.filter((s) => s.id !== id);
      });
      setActiveSpaceId((current) => (current === id ? null : current));
    },
    [api],
  );

  const handleSelectSpace = useCallback((id: string) => {
    setActiveSpaceId(id);
    setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, lastUsedAt: Date.now() } : s)));
  }, []);

  const handleUpdateSpace = useCallback((updated: Space) => {
    setSpaces((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  const handleBack = useCallback(() => {
    setActiveSpaceId(null);
  }, []);

  const activeSpace = useMemo(
    () => spaces.find((s) => s.id === activeSpaceId) ?? null,
    [spaces, activeSpaceId],
  );

  if (!api) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Project context is not available in this environment.
      </div>
    );
  }

  /* ── Active space → detail view ────────────────── */
  if (activeSpace) {
    return (
      <div className="flex-1 flex h-full overflow-hidden">
        <SpaceWorkspace
          key={activeSpace.id}
          space={activeSpace}
          onUpdateSpace={handleUpdateSpace}
          onSaveMessage={onSaveMessage}
          onBack={handleBack}
        />
      </div>
    );
  }

  /* ── No spaces → onboarding ────────────────────── */
  if (spaces.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 relative overflow-hidden">
        {/* Ambient gradient backdrop */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,hsl(var(--accent)/0.08),transparent_60%)]" />

        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald to-emerald/60 flex items-center justify-center mb-6 shadow-glow">
          <Sparkle size={30} weight="fill" className="text-white" />
        </div>
        <h2 className="relative text-2xl font-semibold text-foreground mb-2 tracking-tight">Welcome to Spaces</h2>
        <p className="relative text-[14px] text-muted-foreground/60 max-w-[420px] leading-relaxed mb-8">
          Create a workspace, attach your project folders, and get tailored prompts
          that understand your codebase.
        </p>
        <Button
          size="lg"
          className="relative h-11 px-6 text-[13px] font-semibold gap-2 bg-emerald hover:bg-emerald/90 text-white rounded-xl shadow-glow-sm"
          onClick={() => handleCreateSpace("My Space")}
        >
          <Folder size={16} weight="bold" />
          Create Your First Space
        </Button>
        <div className="relative flex items-center gap-6 mt-10 text-[11px] text-muted-foreground/40 font-medium">
          <span className="flex items-center gap-1.5">
            <Lightning size={11} weight="fill" />
            Codebase-aware
          </span>
          <span className="flex items-center gap-1.5">
            <Eye size={11} weight="fill" />
            Live watching
          </span>
          <span className="flex items-center gap-1.5">
            <Database size={11} weight="fill" />
            Semantic search
          </span>
        </div>
      </div>
    );
  }

  /* ── Has spaces → card grid ────────────────────── */
  return (
    <div className="flex-1 flex h-full overflow-hidden">
      <SpacesList
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        projectStatusMap={projectStatusMap}
        onSelectSpace={handleSelectSpace}
        onCreateSpace={handleCreateSpace}
        onRenameSpace={handleRenameSpace}
        onDeleteSpace={handleDeleteSpace}
      />
    </div>
  );
};

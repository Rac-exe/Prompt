import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as Sentry from '@sentry/react';
import {
  CircleNotch,
  Sparkle, ArrowsClockwise, GitBranch,
  FolderOpen, FolderPlus, FolderMinus,
  Trash, Clock, Square, CaretLeft,
  Microphone, MicrophoneSlash,
  WarningCircle, Gear, ChatCircleText,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { MessageBubble, type Message } from "@/components/chat/MessageBubble";
import { VersionNavigator } from "@/components/chat/VersionNavigator";
import { useSmoothStreaming } from "@/hooks/useSmoothStreaming";
import { useMessageTree, type VersionInfo } from "@/hooks/useMessageTree";
import type { Space, SpaceProject, SpaceMessage, RetrieveResult } from "./types";
import { buildTailoredPrompt, MAX_PROJECTS_PER_SPACE, loadSpaces, saveSpaces } from "./types";
import { useAuth } from "@/context/AuthContext";
import { IndexingProgressBar } from "./IndexingProgressBar";

interface ProjectInfo {
  id: string;
  name: string;
  repo_url?: string;
  local_path?: string;
  current_branch?: string;
  default_branch: string;
  index_status: string;
  last_indexed_at?: string;
}

const STATUS_META: Record<string, { dot: string; label: string; color: string; ring: string }> = {
  ready:    { dot: "bg-emerald-400", label: "Ready",    color: "text-emerald-400", ring: "ring-emerald-400/25" },
  indexing: { dot: "bg-amber-400",   label: "Indexing", color: "text-amber-400",   ring: "ring-amber-400/25" },
  stale:    { dot: "bg-red-400",     label: "Stale",    color: "text-red-400",     ring: "ring-red-400/25" },
  error:    { dot: "bg-red-400",     label: "Error",    color: "text-red-400",     ring: "ring-red-400/25" },
};

function relativeTime(iso?: string): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function shortPath(p?: string): string {
  if (!p) return "";
  const norm = p.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  if (parts.length <= 3) return norm;
  return `…/${parts.slice(-3).join("/")}`;
}

function spaceMessageToMessage(sm: SpaceMessage): Message {
  // Forward version metadata so the bubble can render the version-arrows and
  // useMessageTree.init() can rebuild edit/regen branches from a fresh load.
  return {
    id: sm.id,
    role: sm.role,
    content: sm.content,
    timestamp: new Date(sm.timestamp),
    feedback: sm.feedback,
    groupId: sm.groupId,
    versionIndex: sm.versionIndex,
  };
}

interface SpaceWorkspaceProps {
  space: Space;
  onUpdateSpace: (space: Space) => void;
  /** Open the prompt-library Save modal with arbitrary content (used by the
   *  message bubble's Save button). Replaces the previous onSendToChat which
   *  incorrectly redirected the user to a brand-new chat on Save. */
  onSaveMessage?: (content: string) => void;
  onBack: () => void;
}

type VoiceState = "idle" | "listening" | "processing";

export const SpaceWorkspace = ({ space, onUpdateSpace, onSaveMessage, onBack }: SpaceWorkspaceProps) => {
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [projectStatuses, setProjectStatuses] = useState<Record<string, ProjectInfo>>({});
  const [removeTarget, setRemoveTarget] = useState<SpaceProject | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceActiveRef = useRef(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isStreamingRef = useRef(false);
  const watchStartedRef = useRef<Set<string>>(new Set());
  const spaceRef = useRef(space);
  const onUpdateSpaceRef = useRef(onUpdateSpace);
  // Tracks the latest accumulated text from the backend so we can persist it
  // if the user navigates away before the stream finishes.
  const lastAccumulatedRef = useRef<string>('');
  spaceRef.current = space;
  onUpdateSpaceRef.current = onUpdateSpace;

  // ── Message-tree refs (versioning) ─────────────────────────────────
  // The chat surface uses `useMessageTree` to model edit / regenerate
  // branches as siblings under a shared parent. Spaces now mirrors that
  // model exactly so its UX (version arrows, edit-as-branch, regen-as-
  // branch) is identical. Implementation notes:
  //
  //  • IDs are generated client-side (no async resolution like the chat
  //    has with the backend), so we only need placeholders for the *next*
  //    assistant turn — never for user messages.
  //  • While a turn is in flight we hold its tree-coordinates in refs so
  //    `onStreamingComplete` (a stable callback captured by useSmoothStreaming)
  //    can wire the response into the tree at the correct branch point.
  const messageTree = useMessageTree();
  const pendingPlaceholderRef = useRef<string | null>(null);
  const pendingAssistantParentRef = useRef<string | null>(null);
  const pendingAssistantGroupIdRef = useRef<string | null>(null);
  const pendingAssistantVersionIdxRef = useRef<number>(0);

  const { user } = useAuth();
  const mountedRef = useRef(true);
  const userIdRef = useRef(user?.profile?.id ?? null);
  userIdRef.current = user?.profile?.id ?? null;

  // Mark unmounted so the self-removing completion listener knows not to
  // trigger the animation path (which requires the component to be alive).
  useEffect(() => () => { mountedRef.current = false; }, []);

  const api = (window as any).electronAPI?.project;
  const electronAPI = (window as any).electronAPI;

  // Mapping every message on every keystroke (caused by the input's setState
  // bubbling to the parent space) made the chat thread feel laggy in long
  // sessions. Memoize against the raw messages reference.
  const messages: Message[] = useMemo(() => space.messages.map(spaceMessageToMessage), [space.messages]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // ── Tree (re)initialisation ──────────────────────────────────────
  // Rebuilt only on space switch (the parent uses `key={space.id}` so the
  // component remounts; the ref-guard is belt-and-braces). All subsequent
  // structural mutations go through addChild / addBranch / replaceId.
  //
  // CRITICAL: init runs SYNCHRONOUSLY during the first render, NOT in a
  // useEffect. Otherwise the very first paint would show an empty active
  // path → forcing `displayMessages` into a fallback path that previously
  // returned every persisted message including stale assistant versions
  // (this was the cause of the "regenerate doesn't hide the old version"
  // bug — init was deferred so the tree was momentarily empty after each
  // re-render, and the fallback rendered both old and new bubbles).
  const initRanForSpaceRef = useRef<string | null>(null);
  if (initRanForSpaceRef.current !== space.id) {
    initRanForSpaceRef.current = space.id;
    messageTree.init(messages);
    pendingPlaceholderRef.current = null;
    pendingAssistantParentRef.current = null;
    pendingAssistantGroupIdRef.current = null;
    pendingAssistantVersionIdxRef.current = 0;
  }

  // The hook returns a new `messageTree` object literal every render (the
  // underlying tree state lives in refs inside the hook), so we need the
  // ref pattern to keep the streaming-complete callback truly stable.
  const messageTreeRef = useRef(messageTree);
  messageTreeRef.current = messageTree;

  const handleStreamingComplete = useCallback((finalMessage: Message) => {
    const finalId = finalMessage.id || crypto.randomUUID();
    const placeholder = pendingPlaceholderRef.current;
    const groupId = pendingAssistantGroupIdRef.current || crypto.randomUUID();
    const versionIndex = pendingAssistantVersionIdxRef.current;
    const parentUserId = pendingAssistantParentRef.current;

    // Wipe the in-flight markers FIRST so any synchronous re-render that
    // observes the next state won't think there's still a turn pending.
    pendingPlaceholderRef.current = null;
    pendingAssistantParentRef.current = null;
    pendingAssistantGroupIdRef.current = null;
    pendingAssistantVersionIdxRef.current = 0;

    // Patch the tree FIRST. Doing this before persisting to space.messages
    // means the very next render sees the new branch as the active path,
    // and the assistant lookup against the just-updated messages succeeds
    // in the same render — no flash where the old version reappears
    // because the path momentarily resolved to a stale leaf.
    const tree = messageTreeRef.current;
    if (placeholder) {
      tree.replaceId(placeholder, finalId);
    } else if (parentUserId) {
      tree.addChild(parentUserId, finalId);
    }

    const assistantMsg: SpaceMessage = {
      id: finalId,
      role: "assistant",
      content: finalMessage.content,
      timestamp: Date.now(),
      groupId,
      versionIndex,
    };
    onUpdateSpaceRef.current({
      ...spaceRef.current,
      messages: [...spaceRef.current.messages, assistantMsg],
      lastUsedAt: Date.now(),
    });

    setIsGenerating(false);
    isStreamingRef.current = false;
  }, []);

  const { streamingMessage, startStreaming, handleChunk, handleFinalMessage, stopStreaming, resetStreaming } = useSmoothStreaming({
    onStreamingComplete: handleStreamingComplete,
  });

  // ── Active-path projection (versioning) ──────────────────────────
  // The display thread is the leaf-most active branch of the message tree.
  // Placeholder ids (used while a turn is streaming) are tracked in the tree
  // but absent from `messages`; the lookup-then-filter pattern silently drops
  // them so the streaming bubble below renders in their slot instead.
  //
  // No "if path empty fall back to messages" escape hatch — that would
  // silently bypass version filtering and re-render every persisted
  // sibling (the very bug we're trying to avoid). Init is synchronous
  // (above) so an empty path here means the space genuinely has no
  // messages yet.
  const displayMessages = useMemo<Message[]>(() => {
    const path = messageTree.getActivePath();
    const lookup = new Map(messages.map((m) => [m.id, m]));
    const out: Message[] = [];
    for (const id of path) {
      const m = lookup.get(id);
      if (m) out.push(m);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, messageTree.version]);

  const displayMessagesRef = useRef(displayMessages);
  displayMessagesRef.current = displayMessages;

  const versionInfoMap = useMemo(() => {
    const map = new Map<string, VersionInfo>();
    for (const m of displayMessages) {
      const v = messageTree.getVersionInfo(m.id);
      if (v) map.set(m.id, v);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMessages, messageTree.version]);

  // ── Watch projects (start chokidar on enter) ─────────────────
  useEffect(() => {
    if (!api?.toggleWatching) return;
    for (const proj of space.projects) {
      if (!proj.localPath || watchStartedRef.current.has(proj.projectId)) continue;
      watchStartedRef.current.add(proj.projectId);
      api.toggleWatching(proj.projectId, proj.localPath, true).catch((err: unknown) => {
        Sentry.captureException(err, { tags: { component: 'space-workspace' } });
      });
    }
  }, [api, space.projects]);

  // ── Initial status fetch + auto-reindex stale projects ───────
  // The merge here mirrors ProjectsView's: never let a fetched `stale` clobber
  // an in-flight `indexing` (broadcast or optimistic). Without this guard the
  // status pill would flip Indexing → Stale within ~50ms of attaching a folder,
  // because the freshly-created backend row is `stale` until the Python worker
  // drains its queue.
  useEffect(() => {
    if (!api) return;
    const load = async () => {
      const statuses: Record<string, ProjectInfo> = {};
      for (const p of space.projects) {
        try { const s = await api.status(p.projectId); if (s) statuses[p.projectId] = s; }
        catch (e) { Sentry.captureException(e, { tags: { component: 'space-workspace' } }); }
      }
      setProjectStatuses((prev) => {
        const merged = { ...prev };
        for (const [id, fresh] of Object.entries(statuses)) {
          const existing = prev[id];
          if (!existing) {
            merged[id] = fresh;
          } else if (
            existing.index_status === "indexing" &&
            (fresh.index_status === "stale" || fresh.index_status === "error")
          ) {
            // Preserve in-flight indexing — adopt fresh metadata (branch,
            // last_indexed_at, etc.) but keep our known status.
            merged[id] = { ...fresh, index_status: "indexing" };
          } else {
            merged[id] = { ...existing, ...fresh };
          }
        }
        return merged;
      });
      // Auto-reindex stale projects on entry. Only kick this off based on the
      // FRESHLY fetched value — relying on `merged` above would re-trigger
      // every time we protect an `indexing` state.
      for (const p of space.projects) {
        const s = statuses[p.projectId];
        if (s?.index_status === "stale" && p.localPath) {
          try { api.reindex(p.projectId, p.localPath).catch((err: unknown) => Sentry.captureException(err, { tags: { component: 'space-workspace' } })); }
          catch (e) { Sentry.captureException(e, { tags: { component: 'space-workspace' } }); }
        }
      }
    };
    load();
  }, [api, space.projects]);

  // ── Live status broadcasts from main ─────────────────────────
  useEffect(() => {
    if (!api?.onStatusUpdate) return;
    const unsub = api.onStatusUpdate((data: any) => {
      if (!data?.projectId) return;
      if (!space.projects.find((p) => p.projectId === data.projectId)) return;
      if (data.status) setProjectStatuses((prev) => ({
        ...prev,
        [data.projectId]: { ...prev[data.projectId], index_status: data.status } as ProjectInfo,
      }));
    });
    return () => unsub?.();
  }, [api, space.projects]);

  // ── Optimization stream ──────────────────────────────────────
  useEffect(() => {
    if (!electronAPI) return;

    const c1 = electronAPI.onOptimizationChunk?.((d: any) => {
      if (d.source === 'space' && isStreamingRef.current) {
        lastAccumulatedRef.current = d.accumulated ?? '';
        handleChunk(d.chunk, d.accumulated);
      }
    });

    // The completion listener is intentionally self-removing so it survives
    // component unmount. This ensures the AI response is always saved even
    // when the user navigates away before (or during) streaming.
    const c2Ref = { current: undefined as (() => void) | undefined };
    const completionHandler = (d: any) => {
      if (d.source !== 'space' || !isStreamingRef.current) return;
      // Remove self immediately — prevents double-fire on re-registration.
      c2Ref.current?.();
      c2Ref.current = undefined;

      lastAccumulatedRef.current = '';
      isStreamingRef.current = false;
      setIsGenerating(false);
      const content = d.optimized || '';

      if (mountedRef.current) {
        // Component is alive — use the normal animation path.
        handleFinalMessage({ id: crypto.randomUUID(), role: 'assistant', content, timestamp: new Date() });
      } else {
        // Component is gone — persist the response directly so it's there
        // when the user comes back, regardless of whether ProjectsView is mounted.
        if (!content) return;
        const msg: SpaceMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          timestamp: Date.now(),
          groupId: pendingAssistantGroupIdRef.current || crypto.randomUUID(),
          versionIndex: pendingAssistantVersionIdxRef.current,
        };
        const updated: Space = {
          ...spaceRef.current,
          messages: [...spaceRef.current.messages, msg],
          lastUsedAt: Date.now(),
        };
        // Update React state (no-op if ProjectsView also unmounted, but harmless).
        onUpdateSpaceRef.current(updated);
        // Write to localStorage so the data survives full tab navigation.
        const uid = userIdRef.current;
        const snapshot = loadSpaces(uid);
        saveSpaces(snapshot.map(s => s.id === updated.id ? updated : s), uid);
      }
    };
    c2Ref.current = electronAPI.onOptimizationComplete?.(completionHandler);

    const c3 = electronAPI.onOptimizationError?.((d: any) => {
      if (d.source !== 'space' || !isStreamingRef.current) return;
      c2Ref.current?.(); c2Ref.current = undefined;
      lastAccumulatedRef.current = '';
      isStreamingRef.current = false;
      resetStreaming();
      setIsGenerating(false);
      const cur = spaceRef.current;
      onUpdateSpaceRef.current({
        ...cur,
        messages: [...cur.messages, { id: crypto.randomUUID(), role: 'assistant' as const, content: `Optimization failed: ${d.error}`, timestamp: Date.now() }],
        lastUsedAt: Date.now(),
      });
    });

    return () => {
      c1?.();
      c3?.();
      // Only remove the completion listener if a stream is NOT in flight.
      // If streaming is still active, leave it alive — it will self-remove
      // once the response arrives and save it even after unmount.
      if (!isStreamingRef.current) {
        c2Ref.current?.();
      }
    };
  }, [electronAPI, space.id, handleChunk, handleFinalMessage, resetStreaming]);

  // ── Voice transcription IPC ──────────────────────────────────
  // Mirrors ChatView so the Spaces composer feels identical to the new-chat
  // composer. Transcription drops directly into the textarea state.
  useEffect(() => {
    if (!electronAPI) return;
    electronAPI.transcription?.onTranscription?.((data: any) => {
      if (!voiceActiveRef.current) return;
      const text = (data.accumulated || data.text || "").trim();
      if (text) {
        setInput(text);
        if (data.type === "final") {
          voiceActiveRef.current = false;
          setVoiceState("idle");
        }
      }
    });
    electronAPI.transcription?.onStatus?.((status: string) => {
      if (status === "listening") {
        voiceActiveRef.current = true; setVoiceState("listening"); setVoiceError(null);
      } else if (status === "processing") {
        setVoiceState("processing");
      } else if (status === "stopped") {
        voiceActiveRef.current = false; setVoiceState("idle");
      }
    });
    electronAPI.transcription?.onError?.((error: string) => {
      setVoiceState("idle");
      setVoiceError(error || "Transcription failed.");
      setTimeout(() => setVoiceError(null), 5000);
    });
  }, [electronAPI]);

  // ── Auto-scroll + textarea autosize ──────────────────────────
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [space.messages.length, streamingMessage?.content]);

  const autoResize = useCallback(() => {
    const ta = inputRef.current; if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, []);
  useEffect(() => { autoResize(); }, [input, autoResize]);

  // ── Handlers ─────────────────────────────────────────────────
  const runOptimization = useCallback(async (rawQuery: string) => {
    let tailoredPrompt = rawQuery;
    // Spaces are intentionally always project-aware now — the old "Context"
    // toggle was removed because the whole reason a Space exists is its
    // attached folder. If retrieval fails for every project we still send the
    // raw prompt rather than blocking the user.
    let allRanked: any[] = [], allRelated: any[] = [], fails = 0;
    for (const proj of space.projects) {
      try {
        const d: RetrieveResult = await api.retrieve({ project_id: proj.projectId, query: rawQuery, branch: proj.branch || undefined, limit: 10 });
        if (d.ranked_chunks) allRanked.push(...d.ranked_chunks);
        if (d.related_chunks) allRelated.push(...d.related_chunks);
      } catch (e) {
        Sentry.captureException(e, { tags: { component: 'space-workspace' } });
        fails++;
      }
    }
    if (space.projects.length > 0 && fails === space.projects.length) {
      toast({ title: "Code intelligence unavailable", description: "Sending prompt without project context.", variant: "destructive" });
    } else if (space.projects.length > 0 && allRanked.length === 0 && fails === 0) {
      toast({ title: "No relevant code found", description: "Try reindexing your folder." });
    }
    allRanked.sort((a, b) => b.similarity_score - a.similarity_score);
    allRanked = allRanked.slice(0, 10);
    allRelated = allRelated.slice(0, 5);
    if (space.projects.length > 0) {
      tailoredPrompt = buildTailoredPrompt(rawQuery, allRanked, allRelated);
    }
    lastAccumulatedRef.current = '';
    startStreaming();
    electronAPI?.optimizePrompt?.(tailoredPrompt, false, undefined, "thinking", "space");
  }, [space.projects, api, electronAPI, startStreaming]);

  const handleSubmit = useCallback(async () => {
    const query = input.trim();
    if (!query || isGenerating || space.projects.length === 0) return;
    // If voice is mid-listening, stop it so we don't keep transcribing the
    // user's typed prompt.
    if (voiceState === "listening") {
      voiceActiveRef.current = false;
      electronAPI?.transcription?.stop?.();
      setVoiceState("idle");
    }
    setIsGenerating(true);
    isStreamingRef.current = true; // Set before any async work so the completion
    lastAccumulatedRef.current = ''; // listener survives navigation during retrieval.
    setInput("");

    // Generate IDs / version metadata up-front so the user message and the
    // (yet-to-arrive) assistant message can be wired into the tree atomically.
    const userId = crypto.randomUUID();
    const userGroupId = crypto.randomUUID();
    const assistantGroupId = crypto.randomUUID();
    const placeholderAssistantId = `placeholder-${crypto.randomUUID()}`;

    const userMsg: SpaceMessage = {
      id: userId,
      role: "user",
      content: query,
      timestamp: Date.now(),
      groupId: userGroupId,
      versionIndex: 0,
    };
    onUpdateSpace({ ...space, messages: [...space.messages, userMsg], lastUsedAt: Date.now() });

    // Tree wiring: append user as the next leaf of the active path, then
    // pre-seed a placeholder node for the assistant so the version arrows /
    // active-path computation immediately reflect "we're on a fresh turn".
    const path = messageTree.getActivePath();
    const parentForUser = path.length > 0 ? path[path.length - 1] : messageTree.ROOT;
    messageTree.addChild(parentForUser, userId);
    messageTree.addChild(userId, placeholderAssistantId);

    pendingPlaceholderRef.current = placeholderAssistantId;
    pendingAssistantParentRef.current = userId;
    pendingAssistantGroupIdRef.current = assistantGroupId;
    pendingAssistantVersionIdxRef.current = 0;

    try {
      await runOptimization(query);
    } catch (e: any) {
      Sentry.captureException(e, { tags: { component: 'space-workspace' } });
      setIsGenerating(false);
      isStreamingRef.current = false;
      pendingPlaceholderRef.current = null;
      pendingAssistantParentRef.current = null;
      pendingAssistantGroupIdRef.current = null;
      pendingAssistantVersionIdxRef.current = 0;
      toast({ title: "Failed to process", description: e.message, variant: "destructive" });
    }
  }, [input, isGenerating, space, onUpdateSpace, runOptimization, voiceState, electronAPI, messageTree]);

  const handleStopGeneration = useCallback(() => { stopStreaming(); electronAPI?.stopGeneration?.(); }, [stopStreaming, electronAPI]);

  const toggleVoice = useCallback(() => {
    if (!electronAPI) return;
    if (voiceState === "listening") {
      electronAPI.transcription?.stop?.();
      setVoiceState("processing");
    } else if (voiceState === "idle") {
      setVoiceError(null);
      electronAPI.transcription?.start?.(Date.now().toString());
    }
  }, [electronAPI, voiceState]);

  const handleAddFolder = async () => {
    if (!api || addingFolder) return;
    // Hard guard for the one-folder-per-space rule. The "Add folder" UI
    // hides itself once a folder is attached but this defends against any
    // stale callsite.
    if (space.projects.length >= MAX_PROJECTS_PER_SPACE) {
      toast({
        title: "One folder per space",
        description: "Remove the current folder first, or create a new space.",
      });
      return;
    }
    setAddingFolder(true);
    try {
      const r = await api.add();
      if (r) {
        onUpdateSpace({
          ...space,
          projects: [
            ...space.projects,
            { projectId: r.id, name: r.name, localPath: r.local_path || "", branch: r.current_branch, indexStatus: r.index_status },
          ],
          lastUsedAt: Date.now(),
        });
        // Seed the indexing badge immediately so the user sees "Indexing"
        // before any status broadcast arrives. The freshly-created DB row
        // defaults to 'stale' but the main process queues a full scan
        // synchronously — surface that intent right away.
        setProjectStatuses((prev) => ({
          ...prev,
          [r.id]: { ...prev[r.id], ...r, index_status: "indexing" } as ProjectInfo,
        }));
        if (r.local_path) {
          api.toggleWatching?.(r.id, r.local_path, true).catch((err: unknown) => {
            Sentry.captureException(err, { tags: { component: "space-workspace" } });
          });
          watchStartedRef.current.add(r.id);
        }
        toast({ title: "Folder attached", description: `${r.name} \u2014 indexing in background` });
      }
    } catch (e: any) {
      toast({ title: "Failed to add folder", description: e.message, variant: "destructive" });
    } finally {
      setAddingFolder(false);
    }
  };

  const confirmRemoveProject = (proj: SpaceProject) => setRemoveTarget(proj);

  const handleRemoveProject = (projectId: string) => {
    const proj = space.projects.find(p => p.projectId === projectId);
    if (proj?.localPath) api?.toggleWatching?.(projectId, proj.localPath, false).catch((err: unknown) => {
      Sentry.captureException(err, { tags: { component: 'space-workspace' } });
    });
    watchStartedRef.current.delete(projectId);
    // Cascade-delete on the backend reclaims projects/code_chunks/code_relationships
    // rows in Supabase (FK ON DELETE CASCADE).
    api?.remove?.(projectId).catch((err: unknown) => {
      Sentry.captureException(err, { tags: { component: 'space-workspace', op: 'remove-project' }, extra: { projectId } });
    });
    setProjectStatuses((prev) => { const next = { ...prev }; delete next[projectId]; return next; });
    onUpdateSpace({ ...space, projects: space.projects.filter((p) => p.projectId !== projectId) });
    toast({ title: "Folder removed" });
  };

  const handleReindex = async (proj: SpaceProject) => {
    if (!api || !proj.localPath || reindexingId) return;
    setReindexingId(proj.projectId);
    try {
      const r = await api.reindex(proj.projectId, proj.localPath);
      const finalStatus = (r as any)?.finalStatus || "ready";
      const isOk = finalStatus === "ready" || finalStatus === "partial";
      toast({
        title: isOk ? "Re-index complete" : "Re-index finished with issues",
        description: `${r.totalFiles} files, ${r.totalChunks} chunks · status: ${finalStatus}`,
        variant: isOk ? "default" : "destructive",
      });
      const s = await api.status(proj.projectId);
      if (s) setProjectStatuses((prev) => ({ ...prev, [proj.projectId]: s }));
    } catch (e: any) {
      toast({ title: "Re-index failed", description: e.message, variant: "destructive" });
    } finally {
      setReindexingId(null);
    }
  };

  const handleCopyMessage = (id: string) => {
    const m = space.messages.find((m) => m.id === id);
    if (m) { navigator.clipboard.writeText(m.content); toast({ title: "Copied to clipboard" }); }
  };

  // Save → opens the prompt-library save modal, NOT a new chat.
  // Previously this was wired to onSendToChat which created a brand-new
  // chat with the optimized prompt as its draft — confusing and destructive.
  const handleSaveMessage = (id: string) => {
    const m = space.messages.find((m) => m.id === id);
    if (m && onSaveMessage) onSaveMessage(m.content);
  };

  const handleFeedback = (messageId: string, rating: "positive" | "negative") => {
    onUpdateSpace({ ...space, messages: space.messages.map((m) => m.id === messageId ? { ...m, feedback: { rating } } : m) });
  };

  const handleClearHistory = () => { onUpdateSpace({ ...space, messages: [] }); toast({ title: "History cleared" }); };

  // ── Versioning: edit a user message (creates a sibling user branch) ──
  // Mirrors `Index.tsx#handleEditMessage`. The new user message becomes a
  // sibling of the original under the same parent, which automatically makes
  // it the active branch. We then seed a placeholder for the assistant turn
  // that's about to be optimized so the active path immediately stops
  // showing the previous assistant reply.
  const handleEditMessage = useCallback((messageId: string, newContent: string) => {
    if (isGenerating || space.projects.length === 0) return;
    const original = space.messages.find((m) => m.id === messageId);
    if (!original || original.role !== "user") return;

    const groupId = original.groupId || messageId;
    const existingCount = space.messages.filter((m) => m.groupId === groupId).length;
    const versionIndex = existingCount;

    const newUserId = crypto.randomUUID();
    const newAssistantGroupId = crypto.randomUUID();
    const placeholderAssistantId = `placeholder-${crypto.randomUUID()}`;

    // Tree first: branch the new user version, then seed assistant placeholder.
    messageTree.addBranch(messageId, newUserId);
    messageTree.addChild(newUserId, placeholderAssistantId);

    const newUserMsg: SpaceMessage = {
      id: newUserId,
      role: "user",
      content: newContent,
      timestamp: Date.now(),
      groupId,
      versionIndex,
    };
    onUpdateSpace({ ...space, messages: [...space.messages, newUserMsg], lastUsedAt: Date.now() });

    pendingPlaceholderRef.current = placeholderAssistantId;
    pendingAssistantParentRef.current = newUserId;
    pendingAssistantGroupIdRef.current = newAssistantGroupId;
    pendingAssistantVersionIdxRef.current = 0;

    setIsGenerating(true);
    runOptimization(newContent).catch((e: any) => {
      Sentry.captureException(e, { tags: { component: 'space-workspace', op: 'edit' } });
      isStreamingRef.current = false;
      resetStreaming();
      setIsGenerating(false);
      pendingPlaceholderRef.current = null;
      pendingAssistantParentRef.current = null;
      pendingAssistantGroupIdRef.current = null;
      pendingAssistantVersionIdxRef.current = 0;
      toast({ title: "Edit failed", description: e.message, variant: "destructive" });
    });
  }, [isGenerating, space, onUpdateSpace, runOptimization, resetStreaming, messageTree]);

  // ── Versioning: regenerate an assistant message (sibling assistant branch) ──
  // Crucially does NOT delete the previous version (the old behavior did);
  // both versions are kept and the user can flip between them with the arrows.
  const handleRegenerate = useCallback((assistantMessageId: string) => {
    if (isGenerating || space.projects.length === 0) return;
    const assistantMsg = space.messages.find((m) => m.id === assistantMessageId);
    if (!assistantMsg) return;

    // The user message that fed this assistant is whichever user message is
    // immediately before it in the *active* path (which by construction
    // contains the assistant we're regenerating). Read via ref so this
    // callback's identity doesn't churn every time the active path mutates.
    const dispMsgs = displayMessagesRef.current;
    const idx = dispMsgs.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) return;
    const userMsg = dispMsgs[idx - 1];
    if (userMsg.role !== "user") return;

    const groupId = assistantMsg.groupId || assistantMessageId;
    const existingCount = space.messages.filter((m) => m.groupId === groupId).length;
    const versionIndex = existingCount;
    const placeholderAssistantId = `placeholder-${crypto.randomUUID()}`;

    messageTree.addBranch(assistantMessageId, placeholderAssistantId);

    pendingPlaceholderRef.current = placeholderAssistantId;
    pendingAssistantParentRef.current = userMsg.id;
    pendingAssistantGroupIdRef.current = groupId;
    pendingAssistantVersionIdxRef.current = versionIndex;

    setIsGenerating(true);
    runOptimization(userMsg.content).catch((e: any) => {
      Sentry.captureException(e, { tags: { component: 'space-workspace', op: 'regenerate' } });
      isStreamingRef.current = false;
      resetStreaming();
      setIsGenerating(false);
      pendingPlaceholderRef.current = null;
      pendingAssistantParentRef.current = null;
      pendingAssistantGroupIdRef.current = null;
      pendingAssistantVersionIdxRef.current = 0;
      toast({ title: "Regeneration failed", description: e.message, variant: "destructive" });
    });
  }, [isGenerating, space, runOptimization, resetStreaming, messageTree]);

  const handleNavigateVersion = useCallback(
    (parentId: string, direction: "prev" | "next") => {
      messageTree.navigate(parentId, direction);
    },
    [messageTree],
  );

  const project = space.projects[0];
  const projectStatus = project ? projectStatuses[project.projectId] : undefined;
  const indexStatus = projectStatus?.index_status || project?.indexStatus || "stale";
  const meta = STATUS_META[indexStatus] ?? STATUS_META.stale;
  const hasProject = !!project;
  const canSend = input.trim().length > 0 && !isGenerating && hasProject;

  // ════════════════════════════════════════════════════════════
  // ── Composer (matches ChatView aesthetic, sans Pro Mode / attach) ──
  // ════════════════════════════════════════════════════════════
  // Wider container than ChatView (which is max-w-4xl) — Spaces is a
  // focused workspace, so we let the prompt box breathe across the window
  // instead of leaving a dead column on the right.
  const composer = (
    <div className="w-full max-w-5xl mx-auto">
      <div
        className={cn(
          "relative flex flex-col bg-surface border rounded-2xl transition-all overflow-hidden",
          "border-border focus-within:border-emerald/40 focus-within:shadow-[0_0_0_1px_hsl(var(--accent)/0.1)]",
        )}
      >
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              !hasProject
                ? "Attach a folder to start prompting…"
                : voiceState === "processing"
                ? "Transcribing your voice…"
                : "Describe what you want to build…"
            }
            disabled={!hasProject || voiceState === "processing"}
            rows={2}
            className={cn(
              "w-full bg-transparent border-0 outline-none resize-none",
              "px-5 pt-4 pb-2 text-[14px] leading-relaxed text-foreground",
              "placeholder:text-muted-foreground/55",
              "disabled:opacity-50 scrollbar-none",
            )}
            style={{ minHeight: "72px", maxHeight: "200px", overflow: input.split("\n").length > 6 ? "auto" : "hidden" }}
          />
        </div>

        {/* Bottom toolbar — same skeleton as ChatView, minus Plus / Pro Mode */}
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-2 pl-1">
            {/* Folder context pill — replaces the now-removed Pro Mode pill */}
            {hasProject && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-muted/40 border border-border/30 text-[11px] font-medium text-muted-foreground/80 select-none">
                    <FolderOpen size={11} weight="duotone" className="text-emerald" />
                    <span className="max-w-[140px] truncate">{project!.name}</span>
                    {indexStatus === "indexing" ? (
                      <IndexingProgressBar className="ml-0.5" />
                    ) : (
                      <span className={cn("w-1.5 h-1.5 rounded-full ml-0.5", meta.dot)} />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Codebase context · {meta.label.toLowerCase()}
                </TooltipContent>
              </Tooltip>
            )}
            {voiceState === "listening" && (
              <div className="flex items-center gap-1.5 ml-1 animate-fade-in">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[11px] text-red-400 font-medium">Listening…</span>
              </div>
            )}
            {voiceState === "processing" && (
              <div className="flex items-center gap-1.5 ml-1 animate-fade-in">
                <CircleNotch size={12} weight="light" className="animate-spin text-emerald" />
                <span className="text-[11px] text-emerald font-medium">Transcribing…</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Voice */}
            <button
              type="button"
              onClick={toggleVoice}
              disabled={!hasProject || isGenerating || voiceState === "processing"}
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
                voiceState === "listening"
                  ? "bg-red-500/10 text-red-400"
                  : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary",
                (!hasProject || isGenerating) && "opacity-30 pointer-events-none",
              )}
              title={voiceState === "listening" ? "Stop recording" : "Voice input"}
            >
              {voiceState === "listening" ? <MicrophoneSlash size={16} weight="light" /> :
               voiceState === "processing" ? <CircleNotch size={16} weight="light" className="animate-spin" /> :
               <Microphone size={16} weight="light" />}
            </button>

            {/* Send / Stop */}
            {isGenerating ? (
              <button
                type="button"
                onClick={handleStopGeneration}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all bg-foreground text-background hover:bg-foreground/80"
                title="Stop generation"
              >
                <Square size={12} weight="fill" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSend}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                  canSend
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "bg-muted text-muted-foreground/40 cursor-not-allowed",
                )}
                title="Optimize prompt (Enter)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {voiceError && (
        <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-destructive/8 border border-destructive/20 animate-slide-up">
          <WarningCircle size={14} weight="light" className="text-destructive flex-shrink-0" />
          <span className="text-[12px] text-destructive leading-snug">{voiceError}</span>
        </div>
      )}
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // ── Layout ──
  // ════════════════════════════════════════════════════════════
  // `flex-1 w-full` is critical: the parent in ProjectsView is a row-flex
  // container, and without these the workspace only stretches to fit its
  // widest child (the `max-w-5xl` composer/thread), leaving a dead column
  // on the right of the window.
  return (
    <div className="flex-1 w-full flex flex-col h-full bg-background min-w-0">
      {/* ── Top nav ───────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-8 h-12 border-b border-border/15 flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground/60 hover:text-foreground transition-colors font-medium"
        >
          <CaretLeft size={12} weight="bold" />
          Spaces
        </button>
        <span className="text-muted-foreground/25 text-[13px]">/</span>
        <span className="text-[13px] font-medium text-foreground truncate">{space.name}</span>

        {/* Inline project chip in the breadcrumb — keeps right side breathable */}
        {hasProject && (
          <>
            <span className="text-muted-foreground/25 text-[13px]">·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium text-muted-foreground/80 hover:bg-muted/30 transition-colors cursor-default">
                  <FolderOpen size={11} weight="duotone" className="text-emerald/80" />
                  <span className="max-w-[160px] truncate">{project!.name}</span>
                  {indexStatus === "indexing" ? (
                    <IndexingProgressBar />
                  ) : (
                    <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <div className="space-y-1">
                  <div className="font-medium">{project!.name}</div>
                  {project!.localPath && (
                    <div className="text-muted-foreground/80 text-[10.5px]">{shortPath(project!.localPath)}</div>
                  )}
                  <div className={cn("text-[10.5px]", meta.color)}>{meta.label}</div>
                </div>
              </TooltipContent>
            </Tooltip>
          </>
        )}

        {/* Single "Manage space" menu — consolidates everything that used to
             be split between a standalone Re-index button and a … dropdown.
             Keeps the top nav uncluttered while still putting the destructive
             actions one click away. */}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-7 px-2.5 rounded-lg text-[11.5px] font-medium text-muted-foreground/75 hover:text-foreground hover:bg-muted/30 transition-colors flex items-center gap-1.5"
                aria-label="Manage space"
              >
                <Gear size={12} weight="duotone" />
                Manage
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-72 rounded-2xl shadow-elevated border-border/40 p-0 overflow-hidden"
            >
              {/* ── Header: space name + (when attached) live folder chip ── */}
              <div className="px-3.5 pt-3.5 pb-3 border-b border-border/15 bg-muted/20">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald/10 border border-emerald/20 flex items-center justify-center flex-shrink-0">
                    <Sparkle size={13} weight="duotone" className="text-emerald" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-foreground tracking-tight truncate">
                      {space.name}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground/60">
                      Space settings
                    </div>
                  </div>
                </div>

                {hasProject && (
                  <div className="mt-3 flex items-center gap-2 px-2.5 py-2 rounded-lg bg-card/50 border border-border/25">
                    <FolderOpen size={13} weight="duotone" className="text-emerald flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] font-medium text-foreground/90 truncate">
                        {project!.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground/55 flex items-center gap-1.5 mt-0.5">
                        {(projectStatus?.current_branch || project!.branch) && (
                          <>
                            <GitBranch size={9} weight="bold" />
                            <span className="truncate">{projectStatus?.current_branch || project!.branch}</span>
                            <span className="text-muted-foreground/30">·</span>
                          </>
                        )}
                        <span className={cn("flex items-center gap-1", meta.color)}>
                          {indexStatus === "indexing" ? (
                            <IndexingProgressBar />
                          ) : (
                            <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
                          )}
                          {meta.label}
                        </span>
                      </div>
                      {indexStatus === "indexing" && (
                        <IndexingProgressBar variant="block" className="mt-2" />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Folder section ────────────────────────────────────── */}
              <div className="px-1.5 pt-1.5">
                <div className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold">
                  Folder
                </div>

                {hasProject ? (
                  <>
                    <DropdownMenuItem
                      className="px-2 py-2 gap-2.5 cursor-pointer rounded-lg focus:bg-muted/50"
                      onClick={() => handleReindex(project!)}
                      disabled={!!reindexingId}
                    >
                      <div className="w-7 h-7 rounded-md bg-muted/50 border border-border/30 flex items-center justify-center flex-shrink-0">
                        {reindexingId === project!.projectId ? (
                          <CircleNotch size={13} className="animate-spin text-emerald" />
                        ) : (
                          <ArrowsClockwise size={13} weight="bold" className="text-foreground/80" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-foreground">Re-index folder</div>
                        <div className="text-[10.5px] text-muted-foreground/55 leading-tight">
                          {reindexingId === project!.projectId
                            ? "Reindexing in progress…"
                            : projectStatus?.last_indexed_at
                              ? `Last run ${relativeTime(projectStatus.last_indexed_at)}`
                              : "Never indexed"}
                        </div>
                      </div>
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      className="px-2 py-2 gap-2.5 cursor-pointer rounded-lg focus:bg-destructive/10 text-destructive focus:text-destructive"
                      onClick={() => confirmRemoveProject(project!)}
                    >
                      <div className="w-7 h-7 rounded-md bg-destructive/8 border border-destructive/20 flex items-center justify-center flex-shrink-0">
                        <FolderMinus size={13} weight="duotone" className="text-destructive" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium">Remove folder</div>
                        <div className="text-[10.5px] text-destructive/65 leading-tight">
                          Detach &amp; wipe its index
                        </div>
                      </div>
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem
                    className="px-2 py-2 gap-2.5 cursor-pointer rounded-lg focus:bg-muted/50"
                    onClick={handleAddFolder}
                    disabled={addingFolder}
                  >
                    <div className="w-7 h-7 rounded-md bg-emerald/10 border border-emerald/20 flex items-center justify-center flex-shrink-0">
                      {addingFolder ? (
                        <CircleNotch size={13} className="animate-spin text-emerald" />
                      ) : (
                        <FolderPlus size={13} weight="duotone" className="text-emerald" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-foreground">Add folder</div>
                      <div className="text-[10.5px] text-muted-foreground/55 leading-tight">
                        Attach a codebase to this space
                      </div>
                    </div>
                  </DropdownMenuItem>
                )}
              </div>

              <DropdownMenuSeparator className="my-1.5 mx-2 bg-border/20" />

              {/* ── Conversation section ──────────────────────────────── */}
              <div className="px-1.5 pb-2">
                <div className="px-2 pt-0.5 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold">
                  Conversation
                </div>
                <DropdownMenuItem
                  className="px-2 py-2 gap-2.5 cursor-pointer rounded-lg focus:bg-destructive/10 text-destructive focus:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleClearHistory}
                  disabled={space.messages.length === 0}
                >
                  <div className="w-7 h-7 rounded-md bg-destructive/8 border border-destructive/20 flex items-center justify-center flex-shrink-0">
                    <Trash size={13} weight="duotone" className="text-destructive" />
                  </div>
                  <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[12px] font-medium">Clear history</div>
                      <div className="text-[10.5px] text-destructive/65 leading-tight">
                        {space.messages.length === 0
                          ? "No messages yet"
                          : `Delete all ${space.messages.length} message${space.messages.length === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    {space.messages.length > 0 && (
                      <span className="text-[10px] font-semibold tabular-nums text-destructive/70 px-1.5 py-0.5 rounded bg-destructive/10 border border-destructive/15">
                        {space.messages.length}
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Main ──────────────────────────────────────────── */}
      {!hasProject ? (
        // ─── Empty state: dead simple. No card, no gradients, no
        // shadows, no floating decorative icons. Content is centred
        // both axes inside the now-correctly-full-width workspace.
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald/10 border border-emerald/20 flex items-center justify-center mb-5">
              <FolderPlus size={30} weight="duotone" className="text-emerald" />
            </div>
            <h2 className="text-[22px] font-semibold text-foreground tracking-tight">
              Attach a project folder
            </h2>
            <p className="text-[13.5px] text-muted-foreground/70 mt-2.5 max-w-md leading-relaxed">
              Folders added to <span className="font-semibold text-foreground/85">{space.name}</span> are
              watched, indexed, and kept in sync — every prompt comes back
              tailored to your codebase.
            </p>
            <Button
              className="mt-6 h-10 px-5 text-[13px] font-semibold gap-2 bg-emerald hover:bg-emerald/90 text-white rounded-xl"
              onClick={handleAddFolder}
              disabled={addingFolder}
            >
              {addingFolder ? <CircleNotch size={14} className="animate-spin" /> : <FolderOpen size={14} weight="bold" />}
              Select folder
            </Button>
            <div className="flex items-center gap-5 mt-7 text-[11px] text-muted-foreground/55">
              <span className="flex items-center gap-1.5">
                <Sparkle size={12} weight="duotone" className="text-emerald/70" />
                Always indexed
              </span>
              <span className="flex items-center gap-1.5">
                <GitBranch size={12} weight="duotone" className="text-emerald/70" />
                Branch-aware
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={12} weight="duotone" className="text-emerald/70" />
                Live watching
              </span>
            </div>
          </div>
        </div>
      ) : (
        // ─── Has project → conversation column ───
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto" ref={scrollRef}>
            <div className="max-w-5xl mx-auto px-8 py-8">
              {/* Space header — only shows when there's no chat history yet,
                  so the conversation view stays clean. */}
              {space.messages.length === 0 && !isGenerating && (
                <div className="flex flex-col items-center text-center pt-10 pb-10">
                  <div className="w-12 h-12 rounded-2xl bg-emerald/10 border border-emerald/20 flex items-center justify-center mb-4 shadow-glow-sm">
                    <Sparkle size={22} weight="duotone" className="text-emerald" />
                  </div>
                  <h1 className="text-[22px] font-semibold text-foreground tracking-tight">{space.name}</h1>
                  <p className="text-[13.5px] text-muted-foreground/60 mt-2 max-w-lg leading-relaxed">
                    Ask anything about <span className="text-foreground/85 font-semibold">{project!.name}</span> and
                    you'll get a precise, codebase-grounded prompt back.
                  </p>

                  {/* Project meta strip — moved above suggestions so it sits
                      visually attached to the title block instead of dangling
                      at the bottom of a wide empty area. */}
                  <div className="flex items-center gap-2 mt-5 text-[10.5px] text-muted-foreground/55 font-medium flex-wrap justify-center">
                    <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30 border border-border/20">
                      <FolderOpen size={11} weight="duotone" />
                      {shortPath(project!.localPath)}
                    </span>
                    {(projectStatus?.current_branch || project!.branch) && (
                      <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30 border border-border/20">
                        <GitBranch size={10} weight="bold" />
                        {projectStatus?.current_branch || project!.branch}
                      </span>
                    )}
                    {projectStatus?.last_indexed_at && (
                      <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30 border border-border/20">
                        <Clock size={10} />
                        Indexed {relativeTime(projectStatus.last_indexed_at)}
                      </span>
                    )}
                    <span className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded-md ring-1",
                      meta.color, meta.ring,
                    )}>
                      {indexStatus === "indexing" ? (
                        <IndexingProgressBar />
                      ) : (
                        <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
                      )}
                      {meta.label}
                    </span>
                  </div>

                  {/* Prominent full-width indeterminate bar when indexing.
                      Anchored under the status strip in the empty state so
                      the user immediately sees motion on first load of a
                      new folder — prevents the "did it freeze?" panic. */}
                  {indexStatus === "indexing" && (
                    <div className="mt-3 w-full max-w-sm mx-auto">
                      <IndexingProgressBar variant="block" />
                    </div>
                  )}

                </div>
              )}

              {/* Conversation thread (active path of the message tree).
                  User-message version arrows are inline in the bubble (the
                  pencil-edit triggers a sibling branch). Assistant version
                  arrows render BELOW the bubble — exactly like the chat
                  surface, so the two surfaces share muscle-memory. */}
              <div className="space-y-1">
                {displayMessages.map((msg) => {
                  const versionInfo = versionInfoMap.get(msg.id);
                  return (
                    <div key={msg.id} className="space-y-1">
                      <MessageBubble
                        message={msg}
                        onCopy={() => handleCopyMessage(msg.id)}
                        onSave={() => handleSaveMessage(msg.id)}
                        isSaved={false}
                        onFeedback={msg.role === "assistant" ? handleFeedback : undefined}
                        onEdit={msg.role === "user" ? handleEditMessage : undefined}
                        onRegenerate={msg.role === "assistant" ? handleRegenerate : undefined}
                        isGenerating={isGenerating}
                        versionInfo={msg.role === "user" && versionInfo ? versionInfo : undefined}
                        onNavigateVersion={msg.role === "user" ? handleNavigateVersion : undefined}
                      />
                      {msg.role === "assistant" && versionInfo && (
                        <VersionNavigator
                          current={versionInfo.current}
                          total={versionInfo.total}
                          onPrev={() => handleNavigateVersion(versionInfo.parentId, "prev")}
                          onNext={() => handleNavigateVersion(versionInfo.parentId, "next")}
                          align="left"
                        />
                      )}
                    </div>
                  );
                })}

                {/* Typing indicator — visible only between "user message
                    sent" and "first streaming chunk arrived". Mirrors the
                    indicator in ChatView so the two surfaces feel identical. */}
                {isGenerating && !streamingMessage && (
                  <div className="flex items-center gap-3 animate-fade-in pl-1 pt-2">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span className="text-[11.5px] text-muted-foreground/55 font-medium">
                      Optimizing with codebase context…
                    </span>
                  </div>
                )}

                {streamingMessage && (
                  <MessageBubble
                    message={streamingMessage}
                    onCopy={() => { navigator.clipboard.writeText(streamingMessage.content); toast({ title: "Copied" }); }}
                    onSave={() => {}}
                    isSaved={false}
                    isGenerating={true}
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── Composer ───────────────────────────────────── */}
          <div className="px-6 pb-6 pt-3 flex-shrink-0 border-t border-border/10 bg-background">
            {composer}
          </div>
        </div>
      )}

      {/* Remove-folder confirm */}
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <AlertDialogContent className="bg-card border-border/40 shadow-elevated rounded-2xl max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground text-base font-semibold">
              Remove folder?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm leading-relaxed">
              The index for <span className="font-medium text-foreground">{removeTarget?.name}</span> will be deleted from
              the server and live watching will stop. Your files on disk are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-9 bg-secondary text-foreground border-border hover:bg-secondary/80 text-sm font-medium rounded-xl">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (removeTarget) { handleRemoveProject(removeTarget.projectId); setRemoveTarget(null); } }}
              className="h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-medium rounded-xl"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

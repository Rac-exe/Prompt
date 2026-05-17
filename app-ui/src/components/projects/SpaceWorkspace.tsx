import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as Sentry from '@sentry/react';
import {
  CircleNotch,
  ArrowsClockwise, GitBranch,
  FolderOpen, FolderPlus, FolderMinus,
  Trash, Clock, Square, CaretLeft,
  Microphone, MicrophoneSlash,
  WarningCircle, Gear, ChatCircleText, ArrowDown, Code,
} from "@phosphor-icons/react";
import { Logo } from "@/components/ui/Logo";
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
import { friendlyError } from "@/lib/ipc-error";
import { MessageBubble, type Message } from "@/components/chat/MessageBubble";
import { VersionNavigator } from "@/components/chat/VersionNavigator";
import { useSmoothStreaming } from "@/hooks/useSmoothStreaming";
import { useScrollController } from "@/hooks/useScrollController";
import { useMessageTree, type VersionInfo } from "@/hooks/useMessageTree";
import type { Space, SpaceProject, SpaceMessage, RetrieveResult, ContextResult, RetrievedChunk, ContextLocation } from "./types";
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
type CodeIntelMode = "find" | "ask" | "bug" | "optimize";
const RELEVANT_CHUNK_LIMIT = 20;
const FIND_RESULT_LIMIT = 20;

const CODE_INTEL_MODES: Array<{ value: CodeIntelMode; label: string; description: string; icon: React.ReactNode }> = [
  { value: "optimize", label: "Optimize", description: "Generate an implementation prompt with code context", icon: <Code size={14} weight="duotone" /> },
  { value: "bug", label: "Bug", description: "Find likely files with exact indexed line ranges", icon: <WarningCircle size={14} weight="duotone" /> },
  { value: "ask", label: "Ask", description: "Answer questions about the attached folder", icon: <ChatCircleText size={14} weight="duotone" /> },
  { value: "find", label: "Find", description: "List matching files, symbols, and exact line ranges", icon: <FolderOpen size={14} weight="duotone" /> },
];

type CodeIntelLocation = RetrievedChunk | ContextLocation;

function chunkLines(chunk: CodeIntelLocation): string {
  const start = chunk.start_line;
  const end = chunk.end_line;
  return start === end ? `line ${start}` : `lines ${start}-${end}`;
}

function chunkScore(chunk: CodeIntelLocation): number | undefined {
  const raw = (chunk as any).similarity_score ?? (chunk as any).confidence_score;
  return typeof raw === "number" ? raw : undefined;
}

function formatChunkSummary(chunk: CodeIntelLocation, idx: number): string[] {
  const lines: string[] = [];
  const score = chunkScore(chunk);
  lines.push(
    `${idx}. **${chunk.name || "Code location"}** in \`${shortPath(chunk.file_path)}\` (${chunkLines(chunk)})${score !== undefined ? ` · ${(score * 100).toFixed(0)}%` : ""}`,
  );
  if (chunk.probable_issue) lines.push(`   - Issue: ${chunk.probable_issue}`);
  if (chunk.semantic_summary) lines.push(`   - What it does: ${chunk.semantic_summary}`);
  if (chunk.summary_purpose) lines.push(`   - Why it matters: ${chunk.summary_purpose}`);
  if (chunk.relevance_reasoning) lines.push(`   - Relevance: ${chunk.relevance_reasoning}`);
  if (chunk.concepts?.length) lines.push(`   - Concepts: ${chunk.concepts.slice(0, 5).join(", ")}`);
  return lines;
}

function formatFindResponse(query: string, chunks: CodeIntelLocation[], relatedChunks: CodeIntelLocation[]): string {
  const lines: string[] = [`## Find Results`, "", `Query: ${query}`, ""];
  if (chunks.length === 0) {
    lines.push("No matching code locations were found in the attached folder.");
    return lines.join("\n");
  }

  lines.push("Most likely locations:");
  lines.push("");
  chunks.slice(0, FIND_RESULT_LIMIT).forEach((chunk, idx) => lines.push(...formatChunkSummary(chunk, idx + 1), ""));

  if (relatedChunks.length > 0) {
    lines.push("## Related Code");
    lines.push("");
    relatedChunks.slice(0, 5).forEach((chunk, idx) => {
      lines.push(`${idx + 1}. **${chunk.name || "Related location"}** in \`${shortPath(chunk.file_path)}\` (${chunkLines(chunk)})`);
    });
  }

  return lines.join("\n").trim();
}

function formatAskResponse(query: string, context: ContextResult, fallbackChunks: CodeIntelLocation[]): string {
  const lines: string[] = [`## Answer`, ""];
  lines.push((context.answer || "I could not generate a direct answer from the indexed code context.").trim());
  const sources = (context.sources?.length ? context.sources : context.probable_locations?.length ? context.probable_locations : fallbackChunks) || [];
  if (sources.length > 0) {
    lines.push("", "## Sources", "");
    sources.slice(0, 8).forEach((chunk, idx) => lines.push(...formatChunkSummary(chunk, idx + 1), ""));
  }
  lines.push("", `Query: ${query}`);
  return lines.join("\n").trim();
}

export const SpaceWorkspace = ({ space, onUpdateSpace, onSaveMessage, onBack }: SpaceWorkspaceProps) => {
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [codeIntelMode, setCodeIntelMode] = useState<CodeIntelMode>("optimize");
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
  const activeGenerationIdRef = useRef<string | null>(null);
  // Tracks the latest accumulated text from the backend so we can persist it
  // if the user navigates away before the stream finishes.
  const lastAccumulatedRef = useRef<string>('');
  spaceRef.current = space;
  onUpdateSpaceRef.current = onUpdateSpace;

  // Stable reference to projects — only changes when the project IDs or
  // paths actually change, not when messages/lastUsedAt trigger a new
  // space object. Prevents useEffects that depend on projects from
  // re-running on every message save.
  const projectsKey = useMemo(
    () => space.projects.map(p => `${p.projectId}:${p.localPath}`).join(','),
    [space.projects],
  );
  const stableProjects = useMemo(() => space.projects, [projectsKey]);

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
    console.log('[SW:streamComplete] content length:', finalMessage.content.length, 'placeholder:', pendingPlaceholderRef.current, 'parent:', pendingAssistantParentRef.current);
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

  const { streamingMessage, startStreaming, resumeStreaming, handleChunk, handleFinalMessage, stopStreaming, resetStreaming } = useSmoothStreaming({
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
    for (const proj of stableProjects) {
      if (!proj.localPath || watchStartedRef.current.has(proj.projectId)) continue;
      watchStartedRef.current.add(proj.projectId);
      api.toggleWatching(proj.projectId, proj.localPath, true).catch((err: unknown) => {
        Sentry.captureException(err, { tags: { component: 'space-workspace' } });
      });
    }
  }, [api, stableProjects]);

  // ── Initial status fetch + auto-reindex stale projects ───────
  // The merge here mirrors ProjectsView's: never let a fetched `stale` clobber
  // an in-flight `indexing` (broadcast or optimistic). Without this guard the
  // status pill would flip Indexing → Stale within ~50ms of attaching a folder,
  // because the freshly-created backend row is `stale` until the Python worker
  // drains its queue.
  //
  // Uses `stableProjects` so this only fires on actual project list changes,
  // NOT on every message save (which creates a new space object reference).
  useEffect(() => {
    if (!api) return;
    const load = async () => {
      const statuses: Record<string, ProjectInfo> = {};
      for (const p of stableProjects) {
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
            merged[id] = { ...fresh, index_status: "indexing" };
          } else {
            merged[id] = { ...existing, ...fresh };
          }
        }
        return merged;
      });
      for (const p of stableProjects) {
        const s = statuses[p.projectId];
        if (s?.index_status === "stale" && p.localPath) {
          try {
            const alreadyScanning = await api.isScanning?.(p.projectId);
            if (alreadyScanning) {
              setProjectStatuses((prev) => ({
                ...prev,
                [p.projectId]: { ...prev[p.projectId], ...s, index_status: "indexing" } as ProjectInfo,
              }));
              continue;
            }
            api.reindex(p.projectId, p.localPath).catch((err: unknown) => Sentry.captureException(err, { tags: { component: 'space-workspace' } }));
          } catch (e) { Sentry.captureException(e, { tags: { component: 'space-workspace' } }); }
        }
      }
    };
    load();
  }, [api, stableProjects]);

  // ── Live status broadcasts from main ─────────────────────────
  useEffect(() => {
    if (!api?.onStatusUpdate) return;
    const unsub = api.onStatusUpdate((data: any) => {
      if (!data?.projectId) return;
      if (!stableProjects.find((p) => p.projectId === data.projectId)) return;
      if (data.status) setProjectStatuses((prev) => ({
        ...prev,
        [data.projectId]: { ...prev[data.projectId], index_status: data.status } as ProjectInfo,
      }));
    });
    return () => unsub?.();
  }, [api, stableProjects]);

  // ── Optimization stream ──────────────────────────────────────
  // These listeners stay alive for the lifetime of the component so they
  // handle every generation (first prompt, edits, regenerations). On
  // unmount the cleanup tears them down — UNLESS a stream is in flight,
  // in which case the completion listener is intentionally leaked so it
  // can persist the response to localStorage even after the component is
  // gone (the main-process buffer handles resume on remount).
  useEffect(() => {
    if (!electronAPI) return;

    const c1 = electronAPI.onOptimizationChunk?.((d: any) => {
      if (d.source === 'space' && isStreamingRef.current) {
        lastAccumulatedRef.current = d.accumulated ?? '';
        handleChunk(d.chunk, d.accumulated);
      }
    });

    const c2Unsub = { current: undefined as (() => void) | undefined };
    const completionHandler = (d: any) => {
      console.log('[SW:complete] fired, source:', d.source, 'isStreaming:', isStreamingRef.current, 'mounted:', mountedRef.current);
      if (d.source !== 'space' || !isStreamingRef.current) return;

      lastAccumulatedRef.current = '';
      isStreamingRef.current = false;
      setIsGenerating(false);
      const content = d.optimized || '';

      if (mountedRef.current) {
        handleFinalMessage({ id: crypto.randomUUID(), role: 'assistant', content, timestamp: new Date() });
      } else {
        // Component is gone — persist directly so the data survives.
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
        onUpdateSpaceRef.current(updated);
        const uid = userIdRef.current;
        const snapshot = loadSpaces(uid);
        saveSpaces(snapshot.map(s => s.id === updated.id ? updated : s), uid);
        // Leak is done — clean up so we don't double-fire if the user
        // navigates back and the effect re-runs.
        c2Unsub.current?.();
        c2Unsub.current = undefined;
      }
    };
    c2Unsub.current = electronAPI.onOptimizationComplete?.(completionHandler);

    const c3 = electronAPI.onOptimizationError?.((d: any) => {
      console.log('[SW:error] fired, source:', d.source, 'isStreaming:', isStreamingRef.current);
      if (d.source !== 'space' || !isStreamingRef.current) return;
      lastAccumulatedRef.current = '';
      isStreamingRef.current = false;
      resetStreaming();
      setIsGenerating(false);

      // Replace the placeholder in the tree with the error message so it
      // shows on the active path. Without this the dangling placeholder
      // corrupts navigation and the error message is invisible.
      const errorId = crypto.randomUUID();
      const placeholder = pendingPlaceholderRef.current;
      const parentUserId = pendingAssistantParentRef.current;
      const groupId = pendingAssistantGroupIdRef.current || crypto.randomUUID();
      const versionIndex = pendingAssistantVersionIdxRef.current;

      pendingPlaceholderRef.current = null;
      pendingAssistantParentRef.current = null;
      pendingAssistantGroupIdRef.current = null;
      pendingAssistantVersionIdxRef.current = 0;

      const tree = messageTreeRef.current;
      if (placeholder) {
        tree.replaceId(placeholder, errorId);
      } else if (parentUserId) {
        tree.addChild(parentUserId, errorId);
      }

      const cur = spaceRef.current;
      onUpdateSpaceRef.current({
        ...cur,
        messages: [...cur.messages, {
          id: errorId,
          role: 'assistant' as const,
          content: d.error || "Something went wrong. Please try again.",
          timestamp: Date.now(),
          groupId,
          versionIndex,
          isError: true,
        }],
        lastUsedAt: Date.now(),
      });
    });

    return () => {
      c1?.();
      c3?.();
      // Keep the completion listener alive if a stream is in flight —
      // it will persist the response after unmount. Otherwise tear it down.
      if (!isStreamingRef.current) {
        c2Unsub.current?.();
      }
    };
  }, [electronAPI, space.id, handleChunk, handleFinalMessage, resetStreaming]);

  // ── Mid-stream resume on mount ───────────────────────────────
  // Queries the main-process buffer for any active or recently-completed
  // stream. Two cases:
  //   A) Stream still in progress → resumeStreaming() to show partial
  //      content and continue the typewriter animation.
  //   B) Stream completed while we were unmounted → save the finished
  //      message directly (the optimization-complete event was missed).
  //
  // In both cases we must re-wire the message tree so the assistant
  // message ends up on the active path (the pending refs were lost
  // when the component unmounted).
  useEffect(() => {
    const spaces = (window as any).electronAPI?.spaces;
    if (!spaces?.getActiveStream) return;

    spaces.getActiveStream(space.id).then((state: { accumulated: string; isComplete: boolean } | null) => {
      if (!state || !state.accumulated) return;

      // Find the last user message — this is the parent node the assistant
      // reply must attach to in the version tree.
      const msgs = spaceRef.current.messages;
      const lastUser = [...msgs].reverse().find(m => m.role === 'user');
      if (!lastUser) return;

      // Create a placeholder and wire it into the tree, mirroring handleSubmit.
      const placeholderId = `placeholder-${crypto.randomUUID()}`;
      const tree = messageTreeRef.current;
      tree.addChild(lastUser.id, placeholderId);

      pendingPlaceholderRef.current = placeholderId;
      pendingAssistantParentRef.current = lastUser.id;
      pendingAssistantGroupIdRef.current = crypto.randomUUID();
      pendingAssistantVersionIdxRef.current = 0;

      if (state.isComplete) {
        // Case B: stream finished while away — persist immediately
        const finalMessage = {
          id: 'completed-' + Date.now(),
          role: 'assistant' as const,
          content: state.accumulated,
          timestamp: new Date(),
        };
        handleStreamingComplete(finalMessage);
        return;
      }

      // Case A: stream still in progress — resume animation
      isStreamingRef.current = true;
      lastAccumulatedRef.current = state.accumulated;
      setIsGenerating(true);
      resumeStreaming(state.accumulated);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space.id]);

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

  // ── Scroll controller (mirrors ChatView behavior) ──────────
  const { handleScroll, scrollToBottom, showScrollButton } = useScrollController(
    scrollRef,
    {
      isStreaming: !!streamingMessage,
      messageCount: space.messages.length,
      streamingTrigger: streamingMessage?.content,
    },
  );

  const autoResize = useCallback(() => {
    const ta = inputRef.current; if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, []);
  useEffect(() => { autoResize(); }, [input, autoResize]);

  // ── Handlers ─────────────────────────────────────────────────
  const runOptimization = useCallback(async (rawQuery: string, generationId: string) => {
    if (codeIntelMode === "ask") {
      let combinedContext: ContextResult | null = null;
      let fallbackChunks: CodeIntelLocation[] = [];
      let fails = 0;

      for (const proj of space.projects) {
        if (activeGenerationIdRef.current !== generationId) return;
        try {
          const d: ContextResult = await (api as any).context({
            project_id: proj.projectId,
            query: rawQuery,
            branch: proj.branch || undefined,
            limit: 10,
            mode: "ask",
          });
          if (activeGenerationIdRef.current !== generationId) return;
          combinedContext = {
            ...d,
            probable_locations: [...(combinedContext?.probable_locations || []), ...(d.probable_locations || [])],
            related_locations: [...(combinedContext?.related_locations || []), ...(d.related_locations || [])],
            sources: [...(combinedContext?.sources || []), ...(d.sources || [])],
            answer: combinedContext?.answer ? `${combinedContext.answer}\n\n${d.answer || ""}`.trim() : d.answer,
          };
          fallbackChunks.push(...(d.probable_locations || []));
        } catch (e) {
          Sentry.captureException(e, { tags: { component: 'space-workspace', op: 'ask-context' } });
          fails++;
        }
      }

      if (activeGenerationIdRef.current !== generationId) return;

      if (!combinedContext) {
        if (space.projects.length > 0 && fails === space.projects.length) {
          toast({ title: "Code intelligence unavailable", description: "Could not answer from project context.", variant: "destructive" });
        }
        throw new Error("Code intelligence context unavailable");
      }

      handleStreamingComplete({
        id: crypto.randomUUID(),
        role: "assistant",
        content: formatAskResponse(rawQuery, combinedContext, fallbackChunks),
        timestamp: new Date(),
      });
      return;
    }

    let tailoredPrompt = rawQuery;
    // Spaces are intentionally always project-aware now — the old "Context"
    // toggle was removed because the whole reason a Space exists is its
    // attached folder. If retrieval fails for every project we still send the
    // raw prompt rather than blocking the user.
    let allRanked: any[] = [], allRelated: any[] = [], fails = 0;
    for (const proj of space.projects) {
      if (activeGenerationIdRef.current !== generationId) return;
      try {
        const d: RetrieveResult = await api.retrieve({
          project_id: proj.projectId,
          query: rawQuery,
          branch: proj.branch || undefined,
          limit: codeIntelMode === "find" ? 30 : RELEVANT_CHUNK_LIMIT,
          mode: codeIntelMode,
        });
        if (activeGenerationIdRef.current !== generationId) return;
        if (d.ranked_chunks) allRanked.push(...d.ranked_chunks);
        if (d.related_chunks) allRelated.push(...d.related_chunks);
      } catch (e) {
        Sentry.captureException(e, { tags: { component: 'space-workspace' } });
        fails++;
      }
    }
    
    if (activeGenerationIdRef.current !== generationId) return;

    if (space.projects.length > 0 && fails === space.projects.length) {
      toast({ title: "Code intelligence unavailable", description: "Sending prompt without project context.", variant: "destructive" });
    } else if (space.projects.length > 0 && allRanked.length === 0 && fails === 0) {
      toast({ title: "No relevant code found", description: "Try resyncing your folder." });
    }
    allRanked.sort((a, b) => b.similarity_score - a.similarity_score);
    allRanked = allRanked.slice(0, codeIntelMode === "find" ? FIND_RESULT_LIMIT : RELEVANT_CHUNK_LIMIT);
    allRelated = allRelated.slice(0, 5);

    if (codeIntelMode === "find") {
      if (space.projects.length > 0 && fails === space.projects.length) {
        throw new Error("Code intelligence retrieval unavailable");
      }
      handleStreamingComplete({
        id: crypto.randomUUID(),
        role: "assistant",
        content: formatFindResponse(rawQuery, allRanked, allRelated),
        timestamp: new Date(),
      });
      return;
    }

    if (space.projects.length > 0) {
      tailoredPrompt = buildTailoredPrompt(rawQuery, allRanked, allRelated);
    }
    const primaryProject = space.projects[0];
    lastAccumulatedRef.current = '';
    console.log('[SW:runOpt] retrieval done, calling startStreaming + optimizePrompt');
    startStreaming();
    electronAPI?.optimizePrompt?.(
      tailoredPrompt,
      false,
      undefined,
      "thinking",
      "space",
      space.id,
      primaryProject?.projectId,
      primaryProject?.branch,
    );
  }, [codeIntelMode, space.id, space.projects, api, electronAPI, startStreaming, handleStreamingComplete]);

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
    // Only the prompt-generation modes produce optimizer stream events. Find
    // and Ask answer directly from code intelligence to avoid stale optimizer
    // completions touching the Spaces thread.
    isStreamingRef.current = codeIntelMode === "bug" || codeIntelMode === "optimize";
    lastAccumulatedRef.current = '';
    setInput("");

    const generationId = crypto.randomUUID();
    activeGenerationIdRef.current = generationId;

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
    const nextSpace = { ...space, messages: [...space.messages, userMsg], lastUsedAt: Date.now() };
    spaceRef.current = nextSpace;
    onUpdateSpace(nextSpace);

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
      await runOptimization(query, generationId);
    } catch (e: any) {
      if (activeGenerationIdRef.current !== generationId) return;
      Sentry.captureException(e, { tags: { component: 'space-workspace' } });
      setIsGenerating(false);
      isStreamingRef.current = false;
      pendingPlaceholderRef.current = null;
      pendingAssistantParentRef.current = null;
      pendingAssistantGroupIdRef.current = null;
      pendingAssistantVersionIdxRef.current = 0;
      toast({ title: "Failed to process", description: friendlyError(e, "Something went wrong. Please try again."), variant: "destructive" });
    }
  }, [input, isGenerating, space, onUpdateSpace, runOptimization, voiceState, electronAPI, messageTree, codeIntelMode]);

  const handleStopGeneration = useCallback(() => { 
    activeGenerationIdRef.current = null;
    stopStreaming(); 
    electronAPI?.stopGeneration?.(); 

    // For non-streaming modes like "ask" and "find", we need to manually clear the UI loading state
    // since there won't be an onOptimizationError/onOptimizationComplete event to trigger the cleanup
    if (!isStreamingRef.current && pendingPlaceholderRef.current) {
      setIsGenerating(false);
      
      const errorId = crypto.randomUUID();
      const placeholder = pendingPlaceholderRef.current;
      const parentUserId = pendingAssistantParentRef.current;
      const groupId = pendingAssistantGroupIdRef.current || crypto.randomUUID();
      const versionIndex = pendingAssistantVersionIdxRef.current;

      pendingPlaceholderRef.current = null;
      pendingAssistantParentRef.current = null;
      pendingAssistantGroupIdRef.current = null;
      pendingAssistantVersionIdxRef.current = 0;

      const tree = messageTreeRef.current;
      if (placeholder) {
        tree.replaceId(placeholder, errorId);
      } else if (parentUserId) {
        tree.addChild(parentUserId, errorId);
      }

      const cur = spaceRef.current;
      onUpdateSpaceRef.current({
        ...cur,
        messages: [...cur.messages, {
          id: errorId,
          role: 'assistant' as const,
          content: "Generation stopped.",
          timestamp: Date.now(),
          groupId,
          versionIndex,
          isError: true,
        }],
        lastUsedAt: Date.now(),
      });
    }
  }, [stopStreaming, electronAPI]);

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
      Sentry.captureException(e, { tags: { component: 'space-workspace', op: 'attach-folder' } });
      toast({ title: "Couldn't attach folder", description: friendlyError(e, "Something went wrong. Please try again."), variant: "destructive" });
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
        title: isOk ? "Resync complete" : "Resync finished with issues",
        description: `${r.totalFiles} files, ${r.totalChunks} chunks · status: ${finalStatus}`,
        variant: isOk ? "default" : "destructive",
      });
      const s = await api.status(proj.projectId);
      if (s) setProjectStatuses((prev) => ({ ...prev, [proj.projectId]: s }));
    } catch (e: any) {
      Sentry.captureException(e, { tags: { component: 'space-workspace', op: 'reindex' } });
      toast({ title: "Resync failed", description: friendlyError(e, "Something went wrong while indexing. Please restart the app and try again."), variant: "destructive" });
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
    console.log('[SW:edit] messageId:', messageId, 'isGenerating:', isGenerating);
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
    const nextSpace = { ...space, messages: [...space.messages, newUserMsg], lastUsedAt: Date.now() };
    spaceRef.current = nextSpace;
    onUpdateSpace(nextSpace);

    pendingPlaceholderRef.current = placeholderAssistantId;
    pendingAssistantParentRef.current = newUserId;
    pendingAssistantGroupIdRef.current = newAssistantGroupId;
    pendingAssistantVersionIdxRef.current = 0;

    setIsGenerating(true);
    isStreamingRef.current = codeIntelMode === "bug" || codeIntelMode === "optimize";
    lastAccumulatedRef.current = '';

    const generationId = crypto.randomUUID();
    activeGenerationIdRef.current = generationId;

    runOptimization(newContent, generationId).catch((e: any) => {
      if (activeGenerationIdRef.current !== generationId) return;
      Sentry.captureException(e, { tags: { component: 'space-workspace', op: 'edit' } });
      isStreamingRef.current = false;
      resetStreaming();
      setIsGenerating(false);
      pendingPlaceholderRef.current = null;
      pendingAssistantParentRef.current = null;
      pendingAssistantGroupIdRef.current = null;
      pendingAssistantVersionIdxRef.current = 0;
      toast({ title: "Couldn't edit message", description: friendlyError(e, "Something went wrong. Please try again."), variant: "destructive" });
    });
  }, [isGenerating, space, onUpdateSpace, runOptimization, resetStreaming, messageTree, codeIntelMode]);

  // ── Versioning: regenerate an assistant message (sibling assistant branch) ──
  // Crucially does NOT delete the previous version (the old behavior did);
  // both versions are kept and the user can flip between them with the arrows.
  const handleRegenerate = useCallback((assistantMessageId: string) => {
    console.log('[SW:regen] assistantMessageId:', assistantMessageId, 'isGenerating:', isGenerating);
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
    isStreamingRef.current = codeIntelMode === "bug" || codeIntelMode === "optimize";
    lastAccumulatedRef.current = '';

    const generationId = crypto.randomUUID();
    activeGenerationIdRef.current = generationId;

    runOptimization(userMsg.content, generationId).catch((e: any) => {
      if (activeGenerationIdRef.current !== generationId) return;
      Sentry.captureException(e, { tags: { component: 'space-workspace', op: 'regenerate' } });
      isStreamingRef.current = false;
      resetStreaming();
      setIsGenerating(false);
      pendingPlaceholderRef.current = null;
      pendingAssistantParentRef.current = null;
      pendingAssistantGroupIdRef.current = null;
      pendingAssistantVersionIdxRef.current = 0;
      toast({ title: "Couldn't regenerate", description: friendlyError(e, "Something went wrong. Please try again."), variant: "destructive" });
    });
  }, [isGenerating, space, runOptimization, resetStreaming, messageTree, codeIntelMode]);

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
  const selectedMode = CODE_INTEL_MODES.find((mode) => mode.value === codeIntelMode) ?? CODE_INTEL_MODES[0];

  // ════════════════════════════════════════════════════════════
  // ── Composer (matches ChatView aesthetic, sans Pro Mode / attach) ──
  // ════════════════════════════════════════════════════════════
  const composer = (
    <div className="w-full max-w-5xl mx-auto">
      <div
        className={cn(
          "relative flex flex-col bg-surface border border-border/60 rounded-[20px] transition-all overflow-hidden shadow-sm hover:shadow-md",
          "focus-within:border-emerald/40 focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.04),0_0_0_1px_hsl(var(--accent)/0.1)] focus-within:bg-surface/80 backdrop-blur-xl",
        )}
      >
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              const val = e.target.value;
              
              // Slash command mode switching
              if (val.startsWith('/')) {
                const slashMatch = val.match(/^\/(\w+)\s/);
                if (slashMatch) {
                  const cmd = slashMatch[1].toLowerCase();
                  const matchedMode = CODE_INTEL_MODES.find(
                    (m) => m.value === cmd || m.label.toLowerCase() === cmd
                  );
                  if (matchedMode) {
                    setCodeIntelMode(matchedMode.value);
                    setInput(val.substring(slashMatch[0].length));
                    return;
                  }
                }
              }
              
              setInput(val);
            }}
            onKeyDown={(e) => {
              if (e.key === "Tab" && e.shiftKey) {
                e.preventDefault();
                const currentIndex = CODE_INTEL_MODES.findIndex(m => m.value === codeIntelMode);
                const nextIndex = (currentIndex + 1) % CODE_INTEL_MODES.length;
                setCodeIntelMode(CODE_INTEL_MODES[nextIndex].value);
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              !hasProject
                ? "Attach a folder to start prompting…"
                : voiceState === "processing"
                ? "Transcribing your voice…"
                : codeIntelMode === "find"
                ? "Find a symbol, file, concept, or line…"
                : codeIntelMode === "ask"
                ? "Ask a question about this folder…"
                : codeIntelMode === "bug"
                ? "Describe the bug you want to investigate…"
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

        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-2 pl-1">
            {hasProject && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={isGenerating}
                    className={cn(
                      "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-[11px] font-medium transition-colors",
                      "bg-emerald/8 border-emerald/20 text-emerald hover:bg-emerald/12",
                      isGenerating && "opacity-50 pointer-events-none",
                    )}
                    title="Code intelligence mode"
                  >
                    {selectedMode.icon}
                    {selectedMode.label}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[300px] rounded-xl border-border/40 bg-popover/95 p-1.5 shadow-elevated">
                  <DropdownMenuLabel className="px-2 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/55 flex items-center justify-between">
                    <span>Mode</span>
                    <span className="text-[9px] bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground">Type /</span>
                  </DropdownMenuLabel>
                  {CODE_INTEL_MODES.map((mode) => (
                    <DropdownMenuItem
                      key={mode.value}
                      onSelect={() => setCodeIntelMode(mode.value)}
                      className={cn(
                        "px-2 py-2.5 gap-3 cursor-pointer rounded-lg transition-colors group",
                        mode.value === codeIntelMode ? "bg-emerald/10 text-emerald-foreground" : "hover:bg-muted/50"
                      )}
                    >
                      <div className={cn(
                        "flex items-center justify-center w-7 h-7 rounded-md bg-background shadow-sm border border-border/40 transition-colors flex-shrink-0",
                        mode.value === codeIntelMode ? "text-emerald border-emerald/20" : "text-muted-foreground group-hover:text-foreground"
                      )}>
                        {mode.icon}
                      </div>
                      <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <span className={cn(
                          "text-[12px] font-medium transition-colors",
                          mode.value === codeIntelMode ? "text-emerald" : "text-foreground"
                        )}>{mode.label}</span>
                        <span className="text-[10px] leading-snug text-muted-foreground/65 break-words whitespace-normal">{mode.description}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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

            {isGenerating ? (
              <button
                type="button"
                onClick={handleStopGeneration}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all bg-foreground text-background hover:bg-foreground/80 shadow-sm hover:scale-105"
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
                  "w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm",
                  canSend
                    ? "bg-foreground text-background hover:bg-foreground/90 hover:scale-105"
                    : "bg-muted text-muted-foreground/40 cursor-not-allowed",
                )}
                title={`${selectedMode.label} (Enter)`}
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
              className="w-72 rounded-2xl shadow-elevated border-border/40 bg-popover/95 backdrop-blur-xl p-0 overflow-hidden"
            >
              {/* ── Header: space name + (when attached) live folder chip ── */}
              <div className="px-3.5 pt-3.5 pb-3 border-b border-border/15 bg-muted/20">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-muted/40 border border-border/30 flex items-center justify-center flex-shrink-0">
                    <Gear size={13} weight="duotone" className="text-muted-foreground" />
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
                        <div className="text-[12px] font-medium text-foreground">Resync folder</div>
                        <div className="text-[10.5px] text-muted-foreground/55 leading-tight">
                          {reindexingId === project!.projectId
                            ? "Resyncing in progress…"
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
                          Detach and delete folder info
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
                          : "Delete all messages"}
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
          <div className="flex flex-col items-center text-center max-w-sm">
            <FolderPlus size={32} weight="duotone" className="text-muted-foreground/40 mb-4" />
            <h2 className="text-lg font-semibold text-foreground tracking-tight">
              Attach a project folder
            </h2>
            <p className="text-[13px] text-muted-foreground/60 mt-1.5 leading-relaxed">
              Your codebase will be indexed and kept in sync so every prompt
              is grounded in real code.
            </p>
            <Button
              variant="outline"
              className="mt-5 h-9 px-4 text-[12.5px] font-medium gap-2 rounded-lg"
              onClick={handleAddFolder}
              disabled={addingFolder}
            >
              {addingFolder ? <CircleNotch size={14} className="animate-spin" /> : <FolderOpen size={14} weight="bold" />}
              Select folder
            </Button>
          </div>
        </div>
      ) : (
        // ─── Has project → conversation column ───
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 relative">
          <div className="h-full overflow-y-auto scrollbar-none" ref={scrollRef} onScroll={handleScroll}>
            <div className="max-w-5xl mx-auto px-8 py-8">
              {space.messages.length === 0 && !isGenerating && (
                <div className="pt-[10%] pb-10">
                  <Logo size="w-10 h-10" className="mb-5" />
                  <h1 className="text-[26px] font-bold text-foreground tracking-tight leading-none">
                    {space.name}
                  </h1>
                  <p className="text-[13.5px] text-muted-foreground/60 mt-2.5 max-w-md leading-relaxed">
                    Ask anything about <span className="text-foreground/80 font-medium">{project!.name}</span> — prompts
                    are grounded in your codebase.
                  </p>

                  <div className="flex items-center gap-3 mt-4 text-[11px] text-muted-foreground/50 font-medium">
                    <span className="flex items-center gap-1.5">
                      <FolderOpen size={11} weight="duotone" />
                      {shortPath(project!.localPath)}
                    </span>
                    {(projectStatus?.current_branch || project!.branch) && (
                      <>
                        <span className="text-border">·</span>
                        <span className="flex items-center gap-1">
                          <GitBranch size={10} weight="bold" />
                          {projectStatus?.current_branch || project!.branch}
                        </span>
                      </>
                    )}
                    {indexStatus !== "indexing" && (
                      <>
                        <span className="text-border">·</span>
                        <span className={cn("flex items-center gap-1.5", meta.color)}>
                          <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
                          {meta.label}
                        </span>
                      </>
                    )}
                  </div>

                  {indexStatus === "indexing" && (
                    <div className="flex items-center gap-3 mt-4">
                      <IndexingProgressBar variant="block" className="w-32" />
                      <span className="text-[11px] text-amber-500/70 font-medium animate-pulse">
                        Scanning your codebase…
                      </span>
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
                      {codeIntelMode === "find"
                        ? "Searching the attached folder…"
                        : codeIntelMode === "ask"
                        ? "Answering from codebase context…"
                        : codeIntelMode === "bug"
                        ? "Pinpointing likely bug locations…"
                        : "Optimizing with codebase context…"}
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

          {showScrollButton && (
            <button
              type="button"
              onClick={() => scrollToBottom()}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 w-8 h-8 rounded-full
                         bg-background/90 backdrop-blur border border-border shadow-md
                         flex items-center justify-center
                         text-muted-foreground hover:text-foreground hover:bg-secondary
                         transition-all duration-150"
              aria-label="Scroll to bottom"
            >
              <ArrowDown size={16} weight="light" />
            </button>
          )}
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

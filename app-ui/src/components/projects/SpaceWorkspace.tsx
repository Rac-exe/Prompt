import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as Sentry from '@sentry/react';
import {
  PaperPlaneRight, CircleNotch,
  Sparkle, ArrowsClockwise, GitBranch,
  FolderOpen, Plus,
  Trash, Clock, Square, Power, CaretLeft,
  DotsThree,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { MessageBubble, type Message } from "@/components/chat/MessageBubble";
import { useSmoothStreaming } from "@/hooks/useSmoothStreaming";
import type { Space, SpaceProject, SpaceMessage, RetrieveResult } from "./types";
import { buildTailoredPrompt } from "./types";

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

const STATUS_META: Record<string, { dot: string; label: string; color: string }> = {
  ready:    { dot: "bg-emerald-400", label: "Ready",    color: "text-emerald-400" },
  indexing: { dot: "bg-amber-400",   label: "Indexing", color: "text-amber-400" },
  stale:    { dot: "bg-red-400",     label: "Stale",    color: "text-red-400" },
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

function spaceMessageToMessage(sm: SpaceMessage): Message {
  return { id: sm.id, role: sm.role, content: sm.content, timestamp: new Date(sm.timestamp), feedback: sm.feedback };
}

interface SpaceWorkspaceProps {
  space: Space;
  onUpdateSpace: (space: Space) => void;
  onSendToChat?: (prompt: string) => void;
  onBack: () => void;
}

export const SpaceWorkspace = ({ space, onUpdateSpace, onSendToChat, onBack }: SpaceWorkspaceProps) => {
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [projectStatuses, setProjectStatuses] = useState<Record<string, ProjectInfo>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isStreamingRef = useRef(false);
  const watchStartedRef = useRef<Set<string>>(new Set());
  const spaceRef = useRef(space);
  const onUpdateSpaceRef = useRef(onUpdateSpace);
  spaceRef.current = space;
  onUpdateSpaceRef.current = onUpdateSpace;

  const api = (window as any).electronAPI?.project;
  const electronAPI = (window as any).electronAPI;
  // Mapping every message on every keystroke (caused by the input's setState
  // bubbling to the parent space) made the chat thread feel laggy in long
  // sessions. Memoize against the raw messages reference so we only rebuild
  // when actual chat history changes.
  const messages: Message[] = useMemo(() => space.messages.map(spaceMessageToMessage), [space.messages]);

  const { streamingMessage, startStreaming, handleChunk, handleFinalMessage, stopStreaming, resetStreaming } = useSmoothStreaming({
    onStreamingComplete: (finalMessage: Message) => {
      const assistantMsg: SpaceMessage = { id: finalMessage.id || crypto.randomUUID(), role: "assistant", content: finalMessage.content, timestamp: Date.now() };
      onUpdateSpace({ ...space, messages: [...space.messages, assistantMsg], lastUsedAt: Date.now() });
      setIsGenerating(false);
      isStreamingRef.current = false;
    },
  });

  // ── Hooks (unchanged logic) ─────────────────────────────
  useEffect(() => {
    if (!api?.toggleWatching) return;
    for (const proj of space.projects) {
      if (!proj.localPath || watchStartedRef.current.has(proj.projectId)) continue;
      watchStartedRef.current.add(proj.projectId);
      api.toggleWatching(proj.projectId, proj.localPath, true).catch((err) => { Sentry.captureException(err, { tags: { component: 'space-workspace' } }); });
    }
  }, [api, space.projects]);

  useEffect(() => {
    if (!api) return;
    const load = async () => {
      const statuses: Record<string, ProjectInfo> = {};
      for (const p of space.projects) {
        try { const s = await api.status(p.projectId); if (s) statuses[p.projectId] = s; } catch (e) { Sentry.captureException(e, { tags: { component: 'space-workspace' } }); }
      }
      setProjectStatuses(statuses);
      for (const p of space.projects) {
        const s = statuses[p.projectId];
        if (s?.index_status === "stale" && p.localPath) try { api.reindex(p.projectId, p.localPath).catch((err) => { Sentry.captureException(err, { tags: { component: 'space-workspace' } }); }); } catch (e) { Sentry.captureException(e, { tags: { component: 'space-workspace' } }); }
      }
    };
    load();
  }, [api, space.projects]);

  useEffect(() => {
    if (!api?.onStatusUpdate) return;
    const unsub = api.onStatusUpdate((data: any) => {
      if (!data?.projectId) return;
      if (!space.projects.find((p) => p.projectId === data.projectId)) return;
      if (data.status) setProjectStatuses((prev) => ({ ...prev, [data.projectId]: { ...prev[data.projectId], index_status: data.status } as ProjectInfo }));
    });
    return () => unsub?.();
  }, [api, space.projects]);

  useEffect(() => {
    if (!electronAPI) return;
    const c1 = electronAPI.onOptimizationChunk?.((d: any) => { if (d.source === 'space' && isStreamingRef.current) handleChunk(d.chunk, d.accumulated); });
    const c2 = electronAPI.onOptimizationComplete?.((d: any) => { if (d.source === 'space' && isStreamingRef.current) handleFinalMessage({ id: crypto.randomUUID(), role: "assistant", content: d.optimized || "", timestamp: new Date() }); });
    const c3 = electronAPI.onOptimizationError?.((d: any) => {
      if (d.source !== 'space' || !isStreamingRef.current) return;
      isStreamingRef.current = false; resetStreaming(); setIsGenerating(false);
      const cur = spaceRef.current;
      onUpdateSpaceRef.current({ ...cur, messages: [...cur.messages, { id: crypto.randomUUID(), role: "assistant", content: `Optimization failed: ${d.error}`, timestamp: Date.now() }], lastUsedAt: Date.now() });
    });
    return () => { c1?.(); c2?.(); c3?.(); };
  }, [electronAPI, space.id, handleChunk, handleFinalMessage, resetStreaming]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [space.messages.length, streamingMessage?.content]);

  const autoResize = useCallback(() => { const ta = inputRef.current; if (!ta) return; ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 160) + "px"; }, []);
  useEffect(() => { autoResize(); }, [input, autoResize]);

  // ── Handlers (unchanged logic) ──────────────────────────
  const handleToggleProjectMode = useCallback((enabled: boolean) => {
    onUpdateSpace({ ...space, projectMode: enabled });
    if (enabled) {
      for (const proj of space.projects) { if (!proj.localPath) continue; const s = projectStatuses[proj.projectId]; if (!s || s.index_status === "stale") api?.reindex?.(proj.projectId, proj.localPath).then((r: any) => toast({ title: `Re-indexed ${proj.name}`, description: `${r.totalFiles} files` })).catch((err) => { Sentry.captureException(err, { tags: { component: 'space-workspace' } }); }); api?.toggleWatching?.(proj.projectId, proj.localPath, true).catch((err) => { Sentry.captureException(err, { tags: { component: 'space-workspace' } }); }); }
      toast({ title: "Project Mode enabled", description: "Code context will be injected into prompts" });
    } else {
      for (const proj of space.projects) { if (proj.localPath) api?.toggleWatching?.(proj.projectId, proj.localPath, false).catch((err) => { Sentry.captureException(err, { tags: { component: 'space-workspace' } }); }); }
      toast({ title: "Project Mode disabled" });
    }
  }, [space, onUpdateSpace, api, projectStatuses]);

  const handleSubmit = useCallback(async () => {
    const query = input.trim();
    if (!query || isGenerating || space.projects.length === 0) return;
    setIsGenerating(true); setInput("");
    const userMsg: SpaceMessage = { id: crypto.randomUUID(), role: "user", content: query, timestamp: Date.now() };
    onUpdateSpace({ ...space, messages: [...space.messages, userMsg], lastUsedAt: Date.now() });
    try {
      let tailoredPrompt = query;
      if (space.projectMode) {
        let allRanked: any[] = [], allRelated: any[] = [], fails = 0;
        for (const proj of space.projects) { try { const d: RetrieveResult = await api.retrieve({ project_id: proj.projectId, query, branch: proj.branch || undefined, limit: 10 }); if (d.ranked_chunks) allRanked.push(...d.ranked_chunks); if (d.related_chunks) allRelated.push(...d.related_chunks); } catch (e) { Sentry.captureException(e, { tags: { component: 'space-workspace' } }); fails++; } }
        if (fails === space.projects.length) toast({ title: "Code intelligence unavailable", description: "Sending prompt without project context.", variant: "destructive" });
        else if (allRanked.length === 0 && fails === 0) toast({ title: "No relevant code found", description: "Try reindexing your projects." });
        allRanked.sort((a, b) => b.similarity_score - a.similarity_score); allRanked = allRanked.slice(0, 10); allRelated = allRelated.slice(0, 5);
        tailoredPrompt = buildTailoredPrompt(query, allRanked, allRelated);
      }
      isStreamingRef.current = true; startStreaming();
      electronAPI?.optimizePrompt?.(tailoredPrompt, false, undefined, "thinking", "space");
    } catch (e: any) { Sentry.captureException(e, { tags: { component: 'space-workspace' } }); setIsGenerating(false); isStreamingRef.current = false; toast({ title: "Failed to process", description: e.message, variant: "destructive" }); }
  }, [input, isGenerating, space, api, electronAPI, onUpdateSpace, startStreaming]);

  const handleStopGeneration = useCallback(() => { stopStreaming(); electronAPI?.stopGeneration?.(); }, [stopStreaming, electronAPI]);

  const handleAddFolder = async () => {
    if (!api || addingFolder) return;
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
        // before any status broadcast arrives — the project was *just*
        // queued for a full scan in the main process. We FORCE 'indexing'
        // here even though the freshly-created DB row's `index_status`
        // defaults to 'stale' — otherwise the user sees a "Stale" pill for
        // ~10s until the first poll lands.
        setProjectStatuses((prev) => ({
          ...prev,
          [r.id]: { ...prev[r.id], ...r, index_status: "indexing" } as ProjectInfo,
        }));
        if (r.local_path) {
          api.toggleWatching?.(r.id, r.local_path, true).catch((err) => {
            Sentry.captureException(err, { tags: { component: "space-workspace" } });
          });
          watchStartedRef.current.add(r.id);
        }
        toast({ title: "Folder added", description: `${r.name} \u2014 indexing in background` });
      }
    } catch (e: any) {
      toast({ title: "Failed to add folder", description: e.message, variant: "destructive" });
    } finally {
      setAddingFolder(false);
    }
  };

  const handleRemoveProject = (projectId: string) => {
    const proj = space.projects.find(p => p.projectId === projectId);
    if (proj?.localPath) api?.toggleWatching?.(projectId, proj.localPath, false).catch((err) => { Sentry.captureException(err, { tags: { component: 'space-workspace' } }); });
    watchStartedRef.current.delete(projectId);
    // Cascade-delete on the backend reclaims projects/code_chunks/code_relationships
    // rows in Supabase (FK ON DELETE CASCADE). Without this call the project row
    // would orphan in the user's account.
    api?.remove?.(projectId).catch((err: unknown) => { Sentry.captureException(err, { tags: { component: 'space-workspace', op: 'remove-project' }, extra: { projectId } }); });
    setProjectStatuses((prev) => { const next = { ...prev }; delete next[projectId]; return next; });
    onUpdateSpace({ ...space, projects: space.projects.filter((p) => p.projectId !== projectId) });
    toast({ title: "Folder removed" });
  };

  const handleReindex = async (proj: SpaceProject) => {
    if (!api || !proj.localPath || reindexingId) return;
    setReindexingId(proj.projectId);
    // The main process now blocks until the backend worker reports a terminal
    // status, so this resolves only after embeddings/upserts are done — never
    // before. The toast message reflects the final backend status, not an
    // optimistic "ready".
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

  const handleCopyMessage = (id: string) => { const m = space.messages.find((m) => m.id === id); if (m) { navigator.clipboard.writeText(m.content); toast({ title: "Copied to clipboard" }); } };
  const handleSaveMessage = (id: string) => { const m = space.messages.find((m) => m.id === id); if (m && onSendToChat) { onSendToChat(m.content); toast({ title: "Sent to chat" }); } };
  const handleFeedback = (messageId: string, rating: "positive" | "negative") => { onUpdateSpace({ ...space, messages: space.messages.map((m) => m.id === messageId ? { ...m, feedback: { rating } } : m) }); };
  const handleClearHistory = () => { onUpdateSpace({ ...space, messages: [] }); toast({ title: "History cleared" }); };

  const handleRegenerate = (messageId: string) => {
    const idx = space.messages.findIndex((m) => m.id === messageId); if (idx <= 0) return;
    const userMsg = space.messages[idx - 1]; if (userMsg.role !== "user") return;
    onUpdateSpace({ ...space, messages: space.messages.filter((m) => m.id !== messageId) });
    setTimeout(() => {
      setIsGenerating(true);
      (async () => {
        try {
          let tailoredPrompt = userMsg.content;
          if (space.projectMode) {
            let allRanked: any[] = [], allRelated: any[] = [], fails = 0;
            for (const proj of space.projects) { try { const d: RetrieveResult = await api.retrieve({ project_id: proj.projectId, query: userMsg.content, branch: proj.branch || undefined, limit: 10 }); if (d.ranked_chunks) allRanked.push(...d.ranked_chunks); if (d.related_chunks) allRelated.push(...d.related_chunks); } catch (e) { Sentry.captureException(e, { tags: { component: 'space-workspace' } }); fails++; } }
            if (fails === space.projects.length) toast({ title: "Code intelligence unavailable", variant: "destructive" });
            allRanked.sort((a, b) => b.similarity_score - a.similarity_score); allRanked = allRanked.slice(0, 10); allRelated = allRelated.slice(0, 5);
            tailoredPrompt = buildTailoredPrompt(userMsg.content, allRanked, allRelated);
          }
          isStreamingRef.current = true; startStreaming();
          electronAPI?.optimizePrompt?.(tailoredPrompt, false, undefined, "thinking", "space");
        } catch (e: any) { isStreamingRef.current = false; resetStreaming(); setIsGenerating(false); toast({ title: "Regeneration failed", description: e.message, variant: "destructive" }); }
      })();
    }, 50);
  };

  const hasProjects = space.projects.length > 0;
  const canSend = input.trim().length > 0 && !isGenerating;

  return (
    <div className="flex h-full bg-background">
      {/* ════════ Main Content ════════ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Top nav ─────────────────────────────── */}
        <div className="flex items-center gap-2 px-8 h-12 border-b border-border/15 flex-shrink-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground transition-colors font-medium"
          >
            <CaretLeft size={12} weight="bold" />
            Spaces
          </button>
          <span className="text-muted-foreground/20 text-[13px]">/</span>
          <span className="text-[13px] font-medium text-foreground truncate">{space.name}</span>

          <div className="ml-auto flex items-center gap-2">
            {hasProjects && (
              <div className={cn(
                "flex items-center gap-2 h-7 px-2.5 rounded-lg border transition-colors duration-200",
                space.projectMode ? "border-emerald/15 bg-emerald/[0.04]" : "border-border/15 bg-transparent",
              )}>
                <label
                  htmlFor="pm"
                  className={cn("text-[10px] font-semibold cursor-pointer select-none flex items-center gap-1", space.projectMode ? "text-emerald" : "text-muted-foreground/30")}
                >
                  <Power size={10} weight="bold" />
                  Context
                </label>
                <Switch id="pm" checked={space.projectMode} onCheckedChange={handleToggleProjectMode} className="data-[state=checked]:bg-emerald scale-[0.8]" />
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/25 hover:text-muted-foreground hover:bg-muted/20 transition-colors">
                  <DotsThree size={16} weight="bold" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40 rounded-xl shadow-elevated border-border/40">
                {space.messages.length > 0 && (
                  <DropdownMenuItem className="text-xs gap-2 cursor-pointer text-destructive focus:text-destructive rounded-lg" onClick={handleClearHistory}>
                    <Trash size={13} /> Clear history
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ── Space header ────────────────────────── */}
        <div className="px-8 pt-8 pb-2 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Sparkle size={18} weight="duotone" className="text-emerald" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">{space.name}</h1>
              <p className="text-[12px] text-muted-foreground/40 mt-0.5">
                {space.projectMode ? "Prompts are optimized with codebase context" : "Prompts are optimized without codebase context"}
              </p>
            </div>
          </div>
        </div>

        {/* ── Chat thread ─────────────────────────── */}
        <div className="flex-1 overflow-y-auto" ref={scrollRef}>
          <div className="max-w-3xl px-8 py-6">
            {!hasProjects && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <FolderOpen size={32} weight="duotone" className="text-muted-foreground/20 mb-4" />
                <h3 className="text-[15px] font-semibold text-foreground mb-1.5">Add a project folder</h3>
                <p className="text-[13px] text-muted-foreground/40 max-w-[300px] leading-relaxed mb-5">
                  Attach a codebase so the optimizer understands your project.
                </p>
                <Button size="sm" className="h-9 px-4 text-[12px] font-semibold gap-2 bg-emerald hover:bg-emerald/90 text-white rounded-xl" onClick={handleAddFolder} disabled={addingFolder}>
                  {addingFolder ? <CircleNotch size={13} className="animate-spin" /> : <FolderOpen size={13} weight="bold" />}
                  Select Folder
                </Button>
              </div>
            )}

            {hasProjects && space.messages.length === 0 && !isGenerating && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <h3 className="text-lg font-semibold text-foreground mb-2 tracking-tight">What do you want to build?</h3>
                <p className="text-[13px] text-muted-foreground/40 max-w-[340px] leading-relaxed">
                  Describe a task and get an optimized{space.projectMode ? ", project-aware" : ""} prompt.
                </p>
              </div>
            )}

            <div className="space-y-1">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} onCopy={() => handleCopyMessage(msg.id)} onSave={() => handleSaveMessage(msg.id)} isSaved={false}
                  onFeedback={msg.role === "assistant" ? handleFeedback : undefined} onRegenerate={msg.role === "assistant" ? handleRegenerate : undefined} isGenerating={isGenerating} />
              ))}
              {streamingMessage && (
                <MessageBubble message={streamingMessage} onCopy={() => { navigator.clipboard.writeText(streamingMessage.content); toast({ title: "Copied" }); }} onSave={() => {}} isSaved={false} isGenerating={true} />
              )}
            </div>
          </div>
        </div>

        {/* ── Input ───────────────────────────────── */}
        {hasProjects && (
          <div className="px-8 pb-6 pt-3 flex-shrink-0">
            <div className="max-w-3xl">
              {!space.projectMode && (
                <div className="flex items-center gap-2 mb-2 pl-1">
                  <span className="w-1 h-1 rounded-full bg-amber-400/50" />
                  <span className="text-[11px] text-muted-foreground/30">Context off — prompts optimized without codebase</span>
                </div>
              )}
              <div className={cn(
                "rounded-2xl border transition-all duration-200",
                isGenerating ? "border-emerald/15 bg-emerald/[0.02]" : "border-border/25 bg-card/20 focus-within:border-border/40 focus-within:bg-card/40",
              )}>
                <textarea
                  ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                  placeholder="Describe what you want to do..."
                  rows={1} disabled={isGenerating}
                  className="w-full bg-transparent border-0 outline-none resize-none px-5 pt-4 pb-2 text-[14px] text-foreground leading-relaxed placeholder:text-muted-foreground/20 disabled:opacity-50"
                  style={{ minHeight: 48 }}
                />
                <div className="flex items-center justify-end px-3 pb-3">
                  {isGenerating ? (
                    <Button size="sm" variant="ghost" className="h-8 px-3.5 text-[11px] font-semibold gap-1.5 text-muted-foreground hover:text-foreground rounded-xl" onClick={handleStopGeneration}>
                      <Square size={10} weight="fill" /> Stop
                    </Button>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" className="h-8 w-8 bg-emerald hover:bg-emerald/90 text-white rounded-xl shadow-sm disabled:opacity-20 transition-all" onClick={handleSubmit} disabled={!canSend}>
                          <PaperPlaneRight size={14} weight="fill" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">Optimize prompt</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════ Right Panel — Projects ════════ */}
      <div className="w-[260px] flex-shrink-0 border-l border-border/15 flex flex-col overflow-y-auto">
        <div className="p-5 space-y-5">
          {/* Section heading */}
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-foreground">Projects</h3>
            <span className="text-[10px] text-muted-foreground/30 font-medium">{space.projects.length}</span>
          </div>

          {/* Project list */}
          {space.projects.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-[11px] text-muted-foreground/30 leading-relaxed mb-4">
                Add project folders to use as context for your prompts.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-[11px] font-semibold gap-1.5 text-muted-foreground hover:text-foreground border border-dashed border-border/20 hover:border-border/40 rounded-lg w-full"
                onClick={handleAddFolder}
                disabled={addingFolder}
              >
                {addingFolder ? <CircleNotch size={11} className="animate-spin" /> : <Plus size={11} weight="bold" />}
                Add Folder
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {space.projects.map((proj) => {
                const status = projectStatuses[proj.projectId];
                const isReindexing = reindexingId === proj.projectId;
                const indexStatus = status?.index_status || proj.indexStatus || "stale";
                const meta = STATUS_META[indexStatus] ?? STATUS_META.stale;

                return (
                  <div key={proj.projectId} className="group rounded-xl p-3 hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <FolderOpen size={14} weight="duotone" className="text-muted-foreground/40 flex-shrink-0" />
                      <span className="text-[13px] font-medium text-foreground/80 truncate flex-1">{proj.name}</span>
                      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", meta.dot, indexStatus === "indexing" && "animate-pulse")} />
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 ml-[26px]">
                      <span className={cn("text-[10px] font-medium", meta.color)}>{meta.label}</span>
                      {(status?.current_branch || proj.branch) && (
                        <span className="text-[10px] text-muted-foreground/30 flex items-center gap-0.5">
                          <GitBranch size={9} weight="bold" />
                          {status?.current_branch || proj.branch}
                        </span>
                      )}
                      {status?.last_indexed_at && (
                        <span className="text-[10px] text-muted-foreground/20 flex items-center gap-0.5">
                          <Clock size={8} /> {relativeTime(status.last_indexed_at)}
                        </span>
                      )}
                    </div>
                    {/* Actions on hover */}
                    <div className="flex items-center gap-1 mt-2 ml-[26px] opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="h-6 px-2 rounded text-[10px] font-medium text-muted-foreground/40 hover:text-foreground hover:bg-muted/30 flex items-center gap-1 transition-colors disabled:opacity-30"
                        onClick={() => handleReindex(proj)}
                        disabled={isReindexing}
                      >
                        {isReindexing ? <CircleNotch size={10} className="animate-spin" /> : <ArrowsClockwise size={10} weight="bold" />}
                        Re-index
                      </button>
                      <button
                        className="h-6 px-2 rounded text-[10px] font-medium text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 flex items-center gap-1 transition-colors"
                        onClick={() => handleRemoveProject(proj.projectId)}
                      >
                        <Trash size={10} weight="bold" />
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Add folder */}
              <button
                onClick={handleAddFolder}
                disabled={addingFolder}
                className="w-full flex items-center gap-2 rounded-xl p-3 text-[12px] font-medium text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/15 border border-dashed border-border/10 hover:border-border/20 transition-all disabled:opacity-30"
              >
                {addingFolder ? <CircleNotch size={12} className="animate-spin" /> : <Plus size={12} weight="bold" />}
                Add folder
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

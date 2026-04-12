import { useState, useRef, useEffect, useCallback } from "react";
import {
  PaperPlaneRight, CircleNotch, Lightning,
  Sparkle, ArrowsClockwise, GitBranch, TreeStructure,
  MagnifyingGlass, FolderOpen, Plus,
  Trash, Clock, Square, Power,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

const STATUS_META: Record<string, { color: string; bg: string; dot: string; label: string }> = {
  ready:    { color: "text-emerald-400", bg: "bg-emerald-400/10", dot: "bg-emerald-400", label: "Indexed" },
  indexing: { color: "text-amber-400",   bg: "bg-amber-400/10",   dot: "bg-amber-400",   label: "Indexing" },
  stale:    { color: "text-red-400",     bg: "bg-red-400/10",     dot: "bg-red-400",     label: "Stale" },
};

const QUICK_ACTIONS = [
  { id: "refactor", label: "Refactor", icon: ArrowsClockwise, prefix: "Refactor and improve code quality: " },
  { id: "replace", label: "Replace Dep", icon: GitBranch, prefix: "Replace a dependency or service: " },
  { id: "fix-auth", label: "Fix Auth", icon: TreeStructure, prefix: "Fix authentication flow: " },
  { id: "debug", label: "Debug", icon: MagnifyingGlass, prefix: "Find and fix a bug: " },
  { id: "perf", label: "Performance", icon: Lightning, prefix: "Optimize performance: " },
];

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
  return {
    id: sm.id,
    role: sm.role,
    content: sm.content,
    timestamp: new Date(sm.timestamp),
    feedback: sm.feedback,
  };
}

interface SpaceWorkspaceProps {
  space: Space;
  onUpdateSpace: (space: Space) => void;
  onSendToChat?: (prompt: string) => void;
}

export const SpaceWorkspace = ({ space, onUpdateSpace, onSendToChat }: SpaceWorkspaceProps) => {
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

  const messages: Message[] = space.messages.map(spaceMessageToMessage);

  // Smooth streaming hook
  const {
    streamingMessage,
    startStreaming,
    handleChunk,
    handleFinalMessage,
    stopStreaming,
    resetStreaming,
  } = useSmoothStreaming({
    onStreamingComplete: (finalMessage: Message) => {
      const assistantMsg: SpaceMessage = {
        id: finalMessage.id || crypto.randomUUID(),
        role: "assistant",
        content: finalMessage.content,
        timestamp: Date.now(),
      };

      onUpdateSpace({
        ...space,
        messages: [...space.messages, assistantMsg],
        lastUsedAt: Date.now(),
      });

      setIsGenerating(false);
      isStreamingRef.current = false;
    },
  });

  // Auto-start watchers for all projects on mount and when projects change
  useEffect(() => {
    if (!api?.toggleWatching) return;
    for (const proj of space.projects) {
      if (!proj.localPath || watchStartedRef.current.has(proj.projectId)) continue;
      watchStartedRef.current.add(proj.projectId);
      api.toggleWatching(proj.projectId, proj.localPath, true).catch(() => {});
    }
  }, [api, space.projects]);

  // Load project statuses and auto-reindex stale projects
  useEffect(() => {
    if (!api) return;
    const load = async () => {
      const statuses: Record<string, ProjectInfo> = {};
      for (const p of space.projects) {
        try {
          const status = await api.status(p.projectId);
          if (status) statuses[p.projectId] = status;
        } catch { /* project may have been deleted */ }
      }
      setProjectStatuses(statuses);

      // Auto-reindex any stale projects
      for (const p of space.projects) {
        const s = statuses[p.projectId];
        if (s && s.index_status === "stale" && p.localPath) {
          try {
            api.reindex(p.projectId, p.localPath).catch(() => {});
          } catch { /* ignore */ }
        }
      }
    };
    load();
  }, [api, space.projects]);

  // Subscribe to project status updates
  useEffect(() => {
    if (!api?.onStatusUpdate) return;
    const unsub = api.onStatusUpdate((data: any) => {
      if (!data?.projectId) return;
      const proj = space.projects.find((p) => p.projectId === data.projectId);
      if (!proj) return;
      if (data.status) {
        setProjectStatuses((prev) => ({
          ...prev,
          [data.projectId]: { ...prev[data.projectId], index_status: data.status } as ProjectInfo,
        }));
      }
    });
    return () => unsub?.();
  }, [api, space.projects]);

  // Subscribe to optimization streaming events (stable refs prevent re-subscribing on every render)
  useEffect(() => {
    if (!electronAPI) return;

    const cleanupChunk = electronAPI.onOptimizationChunk?.((data: { chatId: string | null; chunk: string; accumulated: string; source?: 'chat' | 'space' }) => {
      if (data.source !== 'space') return;
      if (!isStreamingRef.current) return;
      handleChunk(data.chunk, data.accumulated);
    });

    const cleanupComplete = electronAPI.onOptimizationComplete?.((data: { original: string; optimized: string; source?: 'chat' | 'space' }) => {
      if (data.source !== 'space') return;
      if (!isStreamingRef.current) return;
      handleFinalMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.optimized || "",
        timestamp: new Date(),
      });
    });

    const cleanupError = electronAPI.onOptimizationError?.((data: { error: string; source?: 'chat' | 'space' }) => {
      if (data.source !== 'space') return;
      if (!isStreamingRef.current) return;
      isStreamingRef.current = false;
      resetStreaming();
      setIsGenerating(false);

      const errorMsg: SpaceMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Optimization failed: ${data.error}`,
        timestamp: Date.now(),
      };
      const currentSpace = spaceRef.current;
      onUpdateSpaceRef.current({
        ...currentSpace,
        messages: [...currentSpace.messages, errorMsg],
        lastUsedAt: Date.now(),
      });
    });

    return () => {
      cleanupChunk?.();
      cleanupComplete?.();
      cleanupError?.();
    };
  }, [electronAPI, space.id, handleChunk, handleFinalMessage, resetStreaming]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [space.messages.length, streamingMessage?.content]);

  const autoResize = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, []);

  useEffect(() => { autoResize(); }, [input, autoResize]);

  const handleToggleProjectMode = useCallback((enabled: boolean) => {
    onUpdateSpace({ ...space, projectMode: enabled });

    if (enabled) {
      // Reindex stale projects when project mode is re-enabled
      for (const proj of space.projects) {
        if (!proj.localPath) continue;
        const status = projectStatuses[proj.projectId];
        if (!status || status.index_status === "stale") {
          api?.reindex?.(proj.projectId, proj.localPath).then((result: any) => {
            toast({ title: `Re-indexed ${proj.name}`, description: `${result.totalFiles} files` });
          }).catch(() => {});
        }
        // Ensure watcher is running
        api?.toggleWatching?.(proj.projectId, proj.localPath, true).catch(() => {});
      }
      toast({ title: "Project Mode enabled", description: "Code context will be injected into prompts" });
    } else {
      for (const proj of space.projects) {
        if (!proj.localPath) continue;
        api?.toggleWatching?.(proj.projectId, proj.localPath, false).catch(() => {});
      }
      toast({ title: "Project Mode disabled", description: "Prompts will be optimized without code context" });
    }
  }, [space, onUpdateSpace, api, projectStatuses]);

  const handleSubmit = useCallback(async () => {
    const query = input.trim();
    if (!query || isGenerating || space.projects.length === 0) return;

    setIsGenerating(true);
    setInput("");

    const userMsg: SpaceMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      timestamp: Date.now(),
    };

    onUpdateSpace({
      ...space,
      messages: [...space.messages, userMsg],
      lastUsedAt: Date.now(),
    });

    try {
      let tailoredPrompt = query;

      // Only inject code context if project mode is ON
      if (space.projectMode) {
        let allRanked: any[] = [];
        let allRelated: any[] = [];
        let retrieveFailures = 0;

        for (const proj of space.projects) {
          try {
            const data: RetrieveResult = await api.retrieve({
              project_id: proj.projectId,
              query,
              branch: proj.branch || undefined,
              limit: 10,
            });
            if (data.ranked_chunks) allRanked.push(...data.ranked_chunks);
            if (data.related_chunks) allRelated.push(...data.related_chunks);
          } catch (e: any) {
            retrieveFailures++;
            console.warn(`[SpaceWorkspace] retrieve failed for ${proj.name}:`, e.message);
          }
        }

        if (retrieveFailures === space.projects.length) {
          toast({
            title: "Code intelligence unavailable",
            description: "Could not retrieve codebase context. Make sure the code-intelligence-service is running (npm run code-intel:dev). Sending prompt without project context.",
            variant: "destructive",
          });
        } else if (allRanked.length === 0 && retrieveFailures === 0) {
          toast({
            title: "No relevant code found",
            description: "The index returned no matching chunks. Try reindexing your projects.",
          });
        }

        allRanked.sort((a, b) => b.similarity_score - a.similarity_score);
        allRanked = allRanked.slice(0, 10);
        allRelated = allRelated.slice(0, 5);

        tailoredPrompt = buildTailoredPrompt(query, allRanked, allRelated);
      }

      isStreamingRef.current = true;
      startStreaming();
      electronAPI?.optimizePrompt?.(tailoredPrompt, false, undefined, "thinking", "space");
    } catch (e: any) {
      setIsGenerating(false);
      isStreamingRef.current = false;
      toast({ title: "Failed to process", description: e.message, variant: "destructive" });
    }
  }, [input, isGenerating, space, api, electronAPI, onUpdateSpace, startStreaming]);

  const handleStopGeneration = useCallback(() => {
    stopStreaming();
    electronAPI?.stopGeneration?.();
  }, [stopStreaming, electronAPI]);

  const handleQuickAction = (action: typeof QUICK_ACTIONS[0]) => {
    const current = input.trim();
    setInput(action.prefix + current);
    inputRef.current?.focus();
  };

  const handleAddFolder = async () => {
    if (!api || addingFolder) return;
    setAddingFolder(true);
    try {
      const result = await api.add();
      if (result) {
        const newProject: SpaceProject = {
          projectId: result.id,
          name: result.name,
          localPath: result.local_path || "",
          branch: result.current_branch,
          indexStatus: result.index_status,
        };
        onUpdateSpace({
          ...space,
          projects: [...space.projects, newProject],
          lastUsedAt: Date.now(),
        });

        // Auto-start watching immediately
        if (result.local_path) {
          api.toggleWatching?.(result.id, result.local_path, true).catch(() => {});
          watchStartedRef.current.add(result.id);
        }

        toast({ title: "Folder added", description: result.name });
      }
    } catch (e: any) {
      toast({ title: "Failed to add folder", description: e.message, variant: "destructive" });
    } finally {
      setAddingFolder(false);
    }
  };

  const handleRemoveProject = (projectId: string) => {
    // Stop watcher for the removed project
    const proj = space.projects.find(p => p.projectId === projectId);
    if (proj?.localPath) {
      api?.toggleWatching?.(projectId, proj.localPath, false).catch(() => {});
    }
    watchStartedRef.current.delete(projectId);

    onUpdateSpace({
      ...space,
      projects: space.projects.filter((p) => p.projectId !== projectId),
    });
    toast({ title: "Folder removed from space" });
  };

  const handleReindex = async (proj: SpaceProject) => {
    if (!api || !proj.localPath || reindexingId) return;
    setReindexingId(proj.projectId);
    try {
      const result = await api.reindex(proj.projectId, proj.localPath);
      toast({ title: "Re-index complete", description: `${result.totalFiles} files, ${result.totalChunks} chunks` });
      const status = await api.status(proj.projectId);
      if (status) setProjectStatuses((prev) => ({ ...prev, [proj.projectId]: status }));
    } catch (e: any) {
      toast({ title: "Re-index failed", description: e.message, variant: "destructive" });
    } finally {
      setReindexingId(null);
    }
  };

  const handleCopyMessage = (id: string) => {
    const msg = space.messages.find((m) => m.id === id);
    if (msg) {
      navigator.clipboard.writeText(msg.content);
      toast({ title: "Copied to clipboard" });
    }
  };

  const handleSaveMessage = (id: string) => {
    const msg = space.messages.find((m) => m.id === id);
    if (msg && onSendToChat) {
      onSendToChat(msg.content);
      toast({ title: "Sent to chat" });
    }
  };

  const handleFeedback = (messageId: string, rating: "positive" | "negative") => {
    onUpdateSpace({
      ...space,
      messages: space.messages.map((m) =>
        m.id === messageId ? { ...m, feedback: { rating } } : m,
      ),
    });
  };

  const handleRegenerate = (messageId: string) => {
    const idx = space.messages.findIndex((m) => m.id === messageId);
    if (idx <= 0) return;
    const userMsg = space.messages[idx - 1];
    if (userMsg.role !== "user") return;

    onUpdateSpace({
      ...space,
      messages: space.messages.filter((m) => m.id !== messageId),
    });

    setTimeout(() => {
      setIsGenerating(true);

      (async () => {
        try {
          let tailoredPrompt = userMsg.content;

          if (space.projectMode) {
            let allRanked: any[] = [];
            let allRelated: any[] = [];
            let retrieveFailures = 0;

            for (const proj of space.projects) {
              try {
                const data: RetrieveResult = await api.retrieve({
                  project_id: proj.projectId,
                  query: userMsg.content,
                  branch: proj.branch || undefined,
                  limit: 10,
                });
                if (data.ranked_chunks) allRanked.push(...data.ranked_chunks);
                if (data.related_chunks) allRelated.push(...data.related_chunks);
              } catch (e: any) {
                retrieveFailures++;
                console.warn(`[SpaceWorkspace] retrieve failed for ${proj.name}:`, e.message);
              }
            }

            if (retrieveFailures === space.projects.length) {
              toast({
                title: "Code intelligence unavailable",
                description: "Regenerating without project context. Start code-intel:dev to enable.",
                variant: "destructive",
              });
            }

            allRanked.sort((a, b) => b.similarity_score - a.similarity_score);
            allRanked = allRanked.slice(0, 10);
            allRelated = allRelated.slice(0, 5);
            tailoredPrompt = buildTailoredPrompt(userMsg.content, allRanked, allRelated);
          }

          isStreamingRef.current = true;
          startStreaming();
          electronAPI?.optimizePrompt?.(tailoredPrompt, false, undefined, "thinking", "space");
        } catch (e: any) {
          isStreamingRef.current = false;
          resetStreaming();
          setIsGenerating(false);
          toast({ title: "Regeneration failed", description: e.message, variant: "destructive" });
        }
      })();
    }, 50);
  };

  const handleClearHistory = () => {
    onUpdateSpace({ ...space, messages: [] });
    toast({ title: "History cleared" });
  };

  const hasProjects = space.projects.length > 0;
  const canSend = input.trim().length > 0 && !isGenerating;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="border-b border-border/40 px-6 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald/20 to-emerald/5 flex items-center justify-center border border-emerald/10">
              <Sparkle size={18} weight="duotone" className="text-emerald" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground tracking-tight">{space.name}</h2>
              <p className="text-[11px] text-muted-foreground/70">
                {space.projects.length} project{space.projects.length !== 1 ? "s" : ""} attached
                {space.messages.length > 0 && ` · ${space.messages.filter(m => m.role === "assistant").length} response${space.messages.filter(m => m.role === "assistant").length !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Project Mode toggle */}
            {hasProjects && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="project-mode-toggle"
                  className={cn(
                    "flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer select-none transition-colors",
                    space.projectMode ? "text-emerald" : "text-muted-foreground/60",
                  )}
                >
                  <Power size={13} weight="bold" />
                  Project Mode
                </label>
                <Switch
                  id="project-mode-toggle"
                  checked={space.projectMode}
                  onCheckedChange={handleToggleProjectMode}
                  className="data-[state=checked]:bg-emerald"
                />
              </div>
            )}

            {space.messages.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg"
                    onClick={handleClearHistory}
                  >
                    <Trash size={15} weight="bold" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Clear history</TooltipContent>
              </Tooltip>
            )}
            <Button
              size="sm"
              className="h-8 px-3 text-[11px] font-semibold gap-1.5 bg-emerald hover:bg-emerald/90 text-white rounded-lg"
              onClick={handleAddFolder}
              disabled={addingFolder}
            >
              {addingFolder ? <CircleNotch size={12} className="animate-spin" /> : <Plus size={12} weight="bold" />}
              Add Folder
            </Button>
          </div>
        </div>

        {/* ── Project Cards (always visible) ─────────────────────── */}
        {space.projects.length > 0 && (
          <div className="space-y-2">
            {space.projects.map((proj) => {
              const status = projectStatuses[proj.projectId];
              const isReindexing = reindexingId === proj.projectId;
              const indexStatus = status?.index_status || proj.indexStatus || "stale";
              const meta = STATUS_META[indexStatus] ?? STATUS_META.stale;

              return (
                <div
                  key={proj.projectId}
                  className="group rounded-xl border border-border/50 bg-card/40 hover:bg-card/60 transition-all px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
                      <FolderOpen size={16} weight="duotone" className="text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate block">{proj.name}</span>
                      <div className="flex items-center gap-2.5 mt-1 flex-wrap">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-md",
                          meta.bg, meta.color,
                        )}>
                          <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot, indexStatus === "indexing" && "animate-pulse")} />
                          {meta.label}
                        </span>
                        {(status?.current_branch || proj.branch) && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/30 px-2 py-0.5 rounded-md">
                            <GitBranch size={10} weight="bold" />
                            {status?.current_branch || proj.branch}
                          </span>
                        )}
                        {status?.last_indexed_at && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
                            <Clock size={9} />
                            {relativeTime(status.last_indexed_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50"
                            onClick={() => handleReindex(proj)}
                            disabled={isReindexing}
                          >
                            {isReindexing
                              ? <CircleNotch size={15} weight="bold" className="animate-spin" />
                              : <ArrowsClockwise size={15} weight="bold" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">Re-index</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleRemoveProject(proj.projectId)}
                          >
                            <Trash size={15} weight="bold" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">Remove</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Chat thread ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="max-w-3xl mx-auto px-6 py-6">
          {!hasProjects && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-muted/60 to-muted/20 flex items-center justify-center mb-4 border border-border/40">
                <FolderOpen size={28} weight="duotone" className="text-muted-foreground/50" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">Add a project folder</h3>
              <p className="text-[12px] text-muted-foreground max-w-[280px] leading-relaxed mb-4">
                Attach a codebase to this space so the optimizer can understand your project.
              </p>
              <Button
                size="sm"
                className="h-9 px-4 text-xs font-semibold gap-1.5 bg-emerald hover:bg-emerald/90 text-white"
                onClick={handleAddFolder}
                disabled={addingFolder}
              >
                {addingFolder ? <CircleNotch size={13} className="animate-spin" /> : <FolderOpen size={13} weight="bold" />}
                Select Folder
              </Button>
            </div>
          )}

          {hasProjects && space.messages.length === 0 && !isGenerating && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/15 to-purple-500/5 flex items-center justify-center mb-4 border border-purple-500/10">
                <Sparkle size={28} weight="duotone" className="text-purple-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">
                Describe an issue or task
              </h3>
              <p className="text-[12px] text-muted-foreground max-w-[320px] leading-relaxed">
                Type what you want to accomplish and get an optimized{space.projectMode ? ", project-aware" : ""} prompt.
                {space.projectMode && " Your codebase context is injected automatically."}
              </p>
            </div>
          )}

          <div className="space-y-1">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onCopy={() => handleCopyMessage(msg.id)}
                onSave={() => handleSaveMessage(msg.id)}
                isSaved={false}
                onFeedback={msg.role === "assistant" ? handleFeedback : undefined}
                onRegenerate={msg.role === "assistant" ? handleRegenerate : undefined}
                isGenerating={isGenerating}
              />
            ))}

            {streamingMessage && (
              <MessageBubble
                message={streamingMessage}
                onCopy={() => {
                  navigator.clipboard.writeText(streamingMessage.content);
                  toast({ title: "Copied" });
                }}
                onSave={() => {}}
                isSaved={false}
                isGenerating={true}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Input bar ───────────────────────────────────────────── */}
      {hasProjects && (
        <div className="border-t border-border/40 px-6 py-4 bg-card/30">
          <div className="max-w-3xl mx-auto">
            {!space.projectMode && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-[10px] text-amber-500/80 font-medium">
                  Project Mode is off — prompts will be optimized without codebase context
                </span>
              </div>
            )}
            <div className={cn(
              "rounded-xl border transition-all",
              isGenerating ? "border-purple-500/30 bg-purple-500/[0.02]" : "border-border/60 bg-card/50",
            )}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
                }}
                placeholder={space.projectMode ? "Describe what you want to do..." : "Enter a prompt to optimize..."}
                rows={1}
                disabled={isGenerating}
                className={cn(
                  "w-full bg-transparent border-0 outline-none resize-none",
                  "px-4 pt-3 pb-1.5 text-sm text-foreground leading-relaxed",
                  "placeholder:text-muted-foreground/40",
                  "disabled:opacity-50",
                )}
                style={{ minHeight: 42 }}
              />
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-1 flex-wrap">
                  {QUICK_ACTIONS.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.id}
                        onClick={() => handleQuickAction(action)}
                        disabled={isGenerating}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 border border-transparent transition-all disabled:opacity-40"
                      >
                        <Icon size={10} weight="bold" />
                        {action.label}
                      </button>
                    );
                  })}
                </div>
                {isGenerating ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-[11px] font-semibold gap-1.5 border-border/60"
                    onClick={handleStopGeneration}
                  >
                    <Square size={10} weight="fill" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-7 px-3.5 text-[11px] font-semibold gap-1.5 bg-emerald hover:bg-emerald/90 text-white shadow-sm disabled:opacity-40"
                    onClick={handleSubmit}
                    disabled={!canSend}
                  >
                    <PaperPlaneRight size={12} weight="fill" />
                    Optimize
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

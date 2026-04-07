import { useState, useEffect, useCallback } from "react";
import {
  FolderOpen, ArrowsClockwise, Trash, TreeStructure,
  CircleNotch, Plus, GitBranch, Clock, CheckCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ProjectInfo {
  id: string;
  name: string;
  repo_url?: string;
  local_path?: string;
  current_branch?: string;
  default_branch: string;
  index_status: string;
  last_indexed_at?: string;
  github_repo_owner?: string;
  github_repo_name?: string;
}

interface StatusUpdate {
  projectId: string;
  status?: string;
  name?: string;
  branch?: string;
  progress?: { current: number; total: number };
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  ready:    { color: "#5a9e7a", label: "Ready" },
  indexing: { color: "#c8a96e", label: "Indexing" },
  stale:    { color: "#c0504a", label: "Stale" },
};

function relativeTime(iso?: string): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export const ProjectsView = () => {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingProject, setAddingProject] = useState(false);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectInfo | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, { current: number; total: number }>>({});

  const api = (window as any).electronAPI?.project;

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const [list, active] = await Promise.all([api.list(), api.getActive()]);
      setProjects(list ?? []);
      setActiveId(active?.projectId ?? null);
    } catch (e) {
      console.error("[ProjectsView] refresh failed:", e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!api?.onStatusUpdate) return;
    const unsub = api.onStatusUpdate((data: StatusUpdate | null) => {
      if (!data) {
        setActiveId(null);
        return;
      }
      if (data.status) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === data.projectId
              ? { ...p, index_status: data.status! }
              : p
          )
        );
      }
      if (data.progress) {
        setProgressMap((prev) => ({ ...prev, [data.projectId]: data.progress! }));
      }
      if (data.status && data.status !== "indexing") {
        setProgressMap((prev) => {
          const next = { ...prev };
          delete next[data.projectId];
          return next;
        });
        refresh();
      }
    });
    return () => unsub?.();
  }, [api, refresh]);

  const handleAdd = async () => {
    if (!api || addingProject) return;
    setAddingProject(true);
    try {
      const result = await api.add();
      if (result) {
        toast({ title: "Project added", description: result.name });
        await refresh();
      }
    } catch (e: any) {
      toast({ title: "Failed to add project", description: e.message, variant: "destructive" });
    } finally {
      setAddingProject(false);
    }
  };

  const handleSetActive = async (project: ProjectInfo) => {
    if (!api) return;
    try {
      await api.setActive(project.id, project.local_path);
      setActiveId(project.id);
    } catch (e: any) {
      toast({ title: "Failed to set active project", description: e.message, variant: "destructive" });
    }
  };

  const handleReindex = async (project: ProjectInfo) => {
    if (!api || !project.local_path || reindexingId) return;
    setReindexingId(project.id);
    try {
      const result = await api.reindex(project.id, project.local_path);
      toast({
        title: "Re-index complete",
        description: `${result.totalFiles} files, ${result.totalChunks} chunks`,
      });
      await refresh();
    } catch (e: any) {
      toast({ title: "Re-index failed", description: e.message, variant: "destructive" });
    } finally {
      setReindexingId(null);
    }
  };

  const handleDelete = async () => {
    if (!api || !deleteTarget) return;
    try {
      await api.remove(deleteTarget.id);
      toast({ title: "Project removed", description: deleteTarget.name });
      setDeleteTarget(null);
      await refresh();
    } catch (e: any) {
      toast({ title: "Failed to remove project", description: e.message, variant: "destructive" });
      setDeleteTarget(null);
    }
  };

  if (!api) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Project context is not available in this environment.
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="flex-1 h-full">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground tracking-tight">Projects</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage codebases for context-aware prompt optimization
              </p>
            </div>
            <Button
              size="sm"
              className="gap-1.5 h-8 text-xs font-medium bg-emerald hover:bg-emerald/90 text-white"
              onClick={handleAdd}
              disabled={addingProject}
            >
              {addingProject ? (
                <CircleNotch size={14} weight="bold" className="animate-spin" />
              ) : (
                <Plus size={14} weight="bold" />
              )}
              Add Project
            </Button>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <CircleNotch size={20} weight="bold" className="animate-spin text-emerald" />
            </div>
          )}

          {/* Empty state */}
          {!loading && projects.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-xl bg-emerald/10 flex items-center justify-center mb-4">
                <TreeStructure size={24} weight="light" className="text-emerald" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1">No projects yet</h3>
              <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">
                Add a project folder to give the optimizer awareness of your codebase structure, functions, and dependencies.
              </p>
              <Button
                size="sm"
                className="mt-5 gap-1.5 h-8 text-xs font-medium bg-emerald hover:bg-emerald/90 text-white"
                onClick={handleAdd}
                disabled={addingProject}
              >
                <FolderOpen size={14} weight="bold" />
                Select Folder
              </Button>
            </div>
          )}

          {/* Project list */}
          {!loading && projects.length > 0 && (
            <div className="space-y-3">
              {projects.map((project) => {
                const isActive = project.id === activeId;
                const meta = STATUS_META[project.index_status] ?? STATUS_META.stale;
                const isIndexing = project.index_status === "indexing";
                const isReindexing = reindexingId === project.id;
                const progress = progressMap[project.id];

                return (
                  <div
                    key={project.id}
                    className={cn(
                      "rounded-xl border bg-black/5 dark:bg-white/5 transition-all",
                      isActive
                        ? "border-emerald/40 shadow-sm"
                        : "border-transparent hover:border-border"
                    )}
                  >
                    {/* Main row */}
                    <div className="px-4 py-3.5 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {/* Name + status */}
                        <div className="flex items-center gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{
                                  backgroundColor: meta.color,
                                  animation: isIndexing ? "pulse 1.5s ease-in-out infinite" : undefined,
                                }}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">{meta.label}</TooltipContent>
                          </Tooltip>
                          <span className="text-sm font-medium text-foreground truncate">
                            {project.name}
                          </span>
                          {isActive && (
                            <span className="text-[10px] font-medium text-emerald bg-emerald/10 px-1.5 py-0.5 rounded-md flex-shrink-0">
                              Active
                            </span>
                          )}
                        </div>

                        {/* Meta details */}
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          {project.current_branch && (
                            <span className="flex items-center gap-1">
                              <GitBranch size={11} weight="bold" />
                              {project.current_branch}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock size={11} weight="bold" />
                            {relativeTime(project.last_indexed_at)}
                          </span>
                          {project.local_path && (
                            <span className="truncate max-w-[200px] opacity-60" title={project.local_path}>
                              {project.local_path}
                            </span>
                          )}
                        </div>

                        {/* Progress bar */}
                        {isIndexing && progress && (
                          <div className="flex items-center gap-2 pt-0.5">
                            <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald rounded-full transition-all duration-300"
                                style={{
                                  width: `${Math.round((progress.current / progress.total) * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                              {Math.round((progress.current / progress.total) * 100)}%
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                        {!isActive && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-emerald hover:bg-emerald/10"
                                onClick={() => handleSetActive(project)}
                              >
                                <CheckCircle size={15} weight="bold" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">Set Active</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-foreground/10"
                              onClick={() => handleReindex(project)}
                              disabled={isReindexing || !project.local_path}
                            >
                              {isReindexing ? (
                                <CircleNotch size={15} weight="bold" className="animate-spin" />
                              ) : (
                                <ArrowsClockwise size={15} weight="bold" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">Re-index</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteTarget(project)}
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
      </ScrollArea>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-card border-border shadow-elevated rounded-xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground text-base font-semibold">
              Remove project?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm leading-relaxed">
              <span className="font-medium text-foreground">&ldquo;{deleteTarget?.name}&rdquo;</span> will
              be removed from your project list and all indexed data will be deleted. This does not affect your
              local files.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel
              onClick={() => setDeleteTarget(null)}
              className="h-9 bg-secondary text-foreground border-border hover:bg-secondary/80 text-sm font-medium"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-medium"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

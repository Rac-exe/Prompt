import { useState, useRef, useEffect } from "react";
import {
  Plus, Folder, DotsThree, Trash, PencilSimple,
  Check, X, Clock,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { Space } from "./types";

interface SpacesListProps {
  spaces: Space[];
  activeSpaceId: string | null;
  onSelectSpace: (id: string) => void;
  onCreateSpace: (name: string) => void;
  onRenameSpace: (id: string, name: string) => void;
  onDeleteSpace: (id: string) => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export const SpacesList = ({
  spaces, activeSpaceId, onSelectSpace,
  onCreateSpace, onRenameSpace, onDeleteSpace,
}: SpacesListProps) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Space | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) createInputRef.current?.focus();
  }, [isCreating]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateSpace(name);
    setNewName("");
    setIsCreating(false);
  };

  const handleRename = () => {
    if (!renamingId || !renameValue.trim()) return;
    onRenameSpace(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
  };

  const sorted = [...spaces].sort((a, b) => b.lastUsedAt - a.lastUsedAt);

  return (
    <div className="flex flex-col h-full border-r border-border/50 bg-card/30">
      {/* Header */}
      <div className="px-4 py-4 border-b border-border/40">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-foreground tracking-tight">Spaces</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg"
            onClick={() => setIsCreating(true)}
          >
            <Plus size={14} weight="bold" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground/70 leading-snug">
          Project workspaces
        </p>
      </div>

      {/* Create space inline */}
      {isCreating && (
        <div className="px-3 py-2.5 border-b border-border/30 bg-muted/20">
          <Input
            ref={createInputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") { setIsCreating(false); setNewName(""); }
            }}
            placeholder="Space name..."
            className="h-8 text-xs bg-background/60 border-border/50 rounded-lg"
          />
          <div className="flex items-center gap-1.5 mt-2">
            <Button
              size="sm"
              className="h-6 px-2.5 text-[10px] font-semibold bg-emerald hover:bg-emerald/90 text-white gap-1"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              <Check size={10} weight="bold" />
              Create
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground"
              onClick={() => { setIsCreating(false); setNewName(""); }}
            >
              <X size={10} weight="bold" />
            </Button>
          </div>
        </div>
      )}

      {/* Space list */}
      <ScrollArea className="flex-1">
        <div className="py-1.5">
          {sorted.length === 0 && !isCreating && (
            <div className="px-4 py-10 text-center">
              <Folder size={28} weight="duotone" className="text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                No spaces yet.
                <br />
                Create one to get started.
              </p>
            </div>
          )}

          {sorted.map((space) => {
            const isActive = space.id === activeSpaceId;
            const isRenaming = renamingId === space.id;

            return (
              <div
                key={space.id}
                className={cn(
                  "group relative mx-1.5 rounded-lg transition-all duration-150 cursor-pointer",
                  isActive
                    ? "bg-emerald/[0.08] border border-emerald/20"
                    : "border border-transparent hover:bg-muted/40",
                )}
                onClick={() => !isRenaming && onSelectSpace(space.id)}
              >
                <div className="px-3 py-2.5">
                  {isRenaming ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <Input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename();
                          if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                        }}
                        className="h-7 text-xs bg-background/60 border-border/50"
                      />
                      <Button
                        variant="ghost" size="icon"
                        className="h-6 w-6 text-emerald hover:bg-emerald/10"
                        onClick={handleRename}
                      >
                        <Check size={11} weight="bold" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-6 w-6 text-muted-foreground"
                        onClick={() => { setRenamingId(null); setRenameValue(""); }}
                      >
                        <X size={11} weight="bold" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          "w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0",
                          isActive ? "bg-emerald/15" : "bg-muted/50",
                        )}>
                          <Folder
                            size={13}
                            weight="duotone"
                            className={isActive ? "text-emerald" : "text-muted-foreground/70"}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn(
                            "text-[13px] font-medium truncate",
                            isActive ? "text-foreground" : "text-foreground/80",
                          )}>
                            {space.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground/60">
                              {space.projects.length} project{space.projects.length !== 1 ? "s" : ""}
                            </span>
                            <span className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5">
                              <Clock size={9} />
                              {relativeTime(space.lastUsedAt)}
                            </span>
                          </div>
                        </div>

                        {/* Context menu */}
                        <div
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                                <DotsThree size={14} weight="bold" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-36">
                              <DropdownMenuItem
                                className="text-xs gap-2 cursor-pointer"
                                onClick={() => {
                                  setRenamingId(space.id);
                                  setRenameValue(space.name);
                                }}
                              >
                                <PencilSimple size={13} />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-xs gap-2 cursor-pointer text-destructive focus:text-destructive"
                                onClick={() => setDeleteTarget(space)}
                              >
                                <Trash size={13} />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-card border-border shadow-elevated rounded-xl max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground text-base font-semibold">
              Delete space?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm leading-relaxed">
              <span className="font-medium text-foreground">&ldquo;{deleteTarget?.name}&rdquo;</span> and
              its prompt history will be permanently deleted. Your project folders are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-9 bg-secondary text-foreground border-border hover:bg-secondary/80 text-sm font-medium">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteTarget) { onDeleteSpace(deleteTarget.id); setDeleteTarget(null); } }}
              className="h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-medium"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

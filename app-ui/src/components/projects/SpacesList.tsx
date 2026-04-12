import { useState, useRef, useEffect } from "react";
import {
  Plus, DotsThree, Trash, PencilSimple,
  Check, X, Clock, Folder,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const SpacesList = ({
  spaces, activeSpaceId: _, onSelectSpace,
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
    if (isCreating) setTimeout(() => createInputRef.current?.focus(), 50);
  }, [isCreating]);

  useEffect(() => {
    if (renamingId) setTimeout(() => renameInputRef.current?.focus(), 50);
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
    <>
      <div className="flex-1 flex flex-col h-full overflow-y-auto">
        {/* ── Header ────────────────────────────────── */}
        <div className="flex items-center justify-between px-10 pt-10 pb-2">
          <h1 className="text-lg font-semibold text-foreground tracking-tight">Spaces</h1>
          <Button
            size="sm"
            className="h-9 px-4 text-[12px] font-semibold gap-1.5 bg-emerald hover:bg-emerald/90 text-white rounded-xl"
            onClick={() => setIsCreating(true)}
          >
            <Plus size={13} weight="bold" />
            New Space
          </Button>
        </div>

        {/* ── Grid ──────────────────────────────────── */}
        <div className="px-10 pt-6 pb-10">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* Create card (inline) */}
            {isCreating && (
              <div className="rounded-2xl border border-emerald/20 bg-emerald/[0.03] p-5 flex flex-col animate-scale-in">
                <div className="w-10 h-10 rounded-xl bg-emerald/10 flex items-center justify-center mb-4">
                  <Plus size={16} weight="bold" className="text-emerald" />
                </div>
                <Input
                  ref={createInputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setIsCreating(false); setNewName(""); }
                  }}
                  placeholder="Space name..."
                  className="h-8 text-[13px] bg-background/50 border-border/30 rounded-lg mb-3"
                  maxLength={40}
                />
                <div className="flex items-center gap-2 mt-auto">
                  <Button
                    size="sm"
                    className="h-7 px-3 text-[11px] font-semibold bg-emerald hover:bg-emerald/90 text-white rounded-lg gap-1"
                    onClick={handleCreate}
                    disabled={!newName.trim()}
                  >
                    <Check size={10} weight="bold" />
                    Create
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2.5 text-[11px] text-muted-foreground"
                    onClick={() => { setIsCreating(false); setNewName(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Space cards */}
            {sorted.map((space) => {
              const isRenaming = renamingId === space.id;

              return (
                <div
                  key={space.id}
                  className="group relative rounded-2xl border border-border/15 bg-card/20 hover:bg-card/50 hover:border-border/30 p-5 cursor-pointer transition-all duration-200"
                  onClick={() => !isRenaming && onSelectSpace(space.id)}
                >
                  {/* Letter avatar */}
                  <div className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center mb-4">
                    <Folder size={18} weight="duotone" className="text-muted-foreground/40" />
                  </div>

                  {/* Name */}
                  {isRenaming ? (
                    <div onClick={(e) => e.stopPropagation()} className="mb-1">
                      <Input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename();
                          if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                        }}
                        onBlur={handleRename}
                        className="h-7 text-[13px] font-semibold bg-background/60 border-border/40 rounded-lg"
                        maxLength={40}
                      />
                    </div>
                  ) : (
                    <h3 className="text-[14px] font-semibold text-foreground mb-1 truncate">
                      {space.name}
                    </h3>
                  )}

                  {/* Meta */}
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground/40">
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {relativeTime(space.lastUsedAt)}
                    </span>
                    {space.projects.length > 0 && (
                      <span>{space.projects.length} project{space.projects.length !== 1 ? "s" : ""}</span>
                    )}
                  </div>

                  {/* Context menu */}
                  <div
                    className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/30 transition-colors">
                          <DotsThree size={16} weight="bold" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36 rounded-xl shadow-elevated border-border/40">
                        <DropdownMenuItem
                          className="text-xs gap-2 cursor-pointer rounded-lg"
                          onClick={() => { setRenamingId(space.id); setRenameValue(space.name); }}
                        >
                          <PencilSimple size={13} />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-xs gap-2 cursor-pointer text-destructive focus:text-destructive rounded-lg"
                          onClick={() => setDeleteTarget(space)}
                        >
                          <Trash size={13} />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-card border-border/40 shadow-elevated rounded-2xl max-w-sm">
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
            <AlertDialogCancel className="h-9 bg-secondary text-foreground border-border hover:bg-secondary/80 text-sm font-medium rounded-xl">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteTarget) { onDeleteSpace(deleteTarget.id); setDeleteTarget(null); } }}
              className="h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-medium rounded-xl"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

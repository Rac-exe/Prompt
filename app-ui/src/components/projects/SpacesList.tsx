import { useState, useRef, useEffect, useMemo, memo, useCallback } from "react";
import {
  Plus, DotsThree, Trash, PencilSimple,
  Check, Clock, MagnifyingGlass, Folder,
  Sparkle, ChatCircleText,
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

// Stable per-name color so each space has its own visual identity at a glance.
const GRADIENTS = [
  "from-emerald-500/80 to-teal-500/60",
  "from-violet-500/80 to-fuchsia-500/60",
  "from-amber-500/80 to-orange-500/60",
  "from-sky-500/80 to-cyan-500/60",
  "from-rose-500/80 to-pink-500/60",
  "from-indigo-500/80 to-blue-500/60",
  "from-lime-500/80 to-green-500/60",
  "from-purple-500/80 to-violet-500/60",
];

function gradientFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || trimmed[0].toUpperCase();
}

// ── Memoized space card ────────────────────────────────────────────────────
// Without memoization every keystroke in the search box re-renders all cards,
// which became visibly laggy past ~20 spaces.
interface SpaceCardProps {
  space: Space;
  isRenaming: boolean;
  renameValue: string;
  onSelect: (id: string) => void;
  onStartRename: (id: string, name: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onChangeRenameValue: (value: string) => void;
  onRequestDelete: (space: Space) => void;
  renameInputRef: React.RefObject<HTMLInputElement>;
}

const SpaceCard = memo(function SpaceCard({
  space,
  isRenaming,
  renameValue,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onChangeRenameValue,
  onRequestDelete,
  renameInputRef,
}: SpaceCardProps) {
  const gradient = useMemo(() => gradientFor(space.id || space.name), [space.id, space.name]);
  const letters = useMemo(() => initials(space.name), [space.name]);
  const projectCount = space.projects.length;
  const messageCount = space.messages.length;

  return (
    <div
      onClick={() => !isRenaming && onSelect(space.id)}
      className={cn(
        "group relative rounded-2xl border border-border/30 bg-card/40",
        "hover:border-border/60 hover:bg-card/60 hover:shadow-card-hover",
        "p-5 cursor-pointer transition-all duration-200 will-change-transform",
        "hover:-translate-y-0.5 overflow-hidden",
      )}
    >
      {/* Subtle ambient glow on hover */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
          "bg-gradient-to-br", gradient,
        )}
        style={{ maskImage: "radial-gradient(circle at top right, black, transparent 70%)" }}
      />

      <div className="relative flex items-start gap-3 mb-4">
        <div
          className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0",
            "bg-gradient-to-br shadow-sm text-white text-[13px] font-bold tracking-tight",
            gradient,
          )}
        >
          {letters}
        </div>

        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <div onClick={(e) => e.stopPropagation()}>
              <Input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => onChangeRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitRename();
                  if (e.key === "Escape") onCancelRename();
                }}
                onBlur={onCommitRename}
                className="h-8 text-[14px] font-semibold bg-background/70 border-border/50 rounded-lg"
                maxLength={40}
              />
            </div>
          ) : (
            <h3 className="text-[14px] font-semibold text-foreground truncate leading-tight">
              {space.name}
            </h3>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 mt-1">
            <Clock size={10} weight="bold" />
            <span>{relativeTime(space.lastUsedAt)}</span>
          </div>
        </div>
      </div>

      {/* Stats footer */}
      <div className="relative flex items-center gap-3 text-[11px] text-muted-foreground/70 font-medium">
        <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30">
          <Folder size={11} weight="duotone" />
          {projectCount} {projectCount === 1 ? "project" : "projects"}
        </span>
        {messageCount > 0 && (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30">
            <ChatCircleText size={11} weight="duotone" />
            {messageCount}
          </span>
        )}
      </div>

      {/* Context menu */}
      <div
        className="absolute top-3.5 right-3.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-background/80 backdrop-blur transition-colors"
              aria-label="Space options"
            >
              <DotsThree size={16} weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 rounded-xl shadow-elevated border-border/40">
            <DropdownMenuItem
              className="text-xs gap-2 cursor-pointer rounded-lg"
              onClick={() => onStartRename(space.id, space.name)}
            >
              <PencilSimple size={13} />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs gap-2 cursor-pointer text-destructive focus:text-destructive rounded-lg"
              onClick={() => onRequestDelete(space)}
            >
              <Trash size={13} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

export const SpacesList = ({
  spaces, onSelectSpace,
  onCreateSpace, onRenameSpace, onDeleteSpace,
}: SpacesListProps) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Space | null>(null);
  const [search, setSearch] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) {
      const id = setTimeout(() => createInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [isCreating]);

  useEffect(() => {
    if (renamingId) {
      const id = setTimeout(() => renameInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [renamingId]);

  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    onCreateSpace(name);
    setNewName("");
    setIsCreating(false);
  }, [newName, onCreateSpace]);

  const handleCommitRename = useCallback(() => {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (name) onRenameSpace(renamingId, name);
    setRenamingId(null);
    setRenameValue("");
  }, [renamingId, renameValue, onRenameSpace]);

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  const handleStartRename = useCallback((id: string, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
  }, []);

  const handleRequestDelete = useCallback((space: Space) => {
    setDeleteTarget(space);
  }, []);

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? spaces.filter((s) => s.name.toLowerCase().includes(q))
      : spaces;
    return [...filtered].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }, [spaces, search]);

  const totalProjects = useMemo(
    () => spaces.reduce((acc, s) => acc + s.projects.length, 0),
    [spaces],
  );

  return (
    <>
      <div className="flex-1 flex flex-col h-full overflow-y-auto" style={{ contain: "layout paint" }}>
        {/* ── Hero header ─────────────────────────────── */}
        <div className="relative px-10 pt-10 pb-6">
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,hsl(var(--accent)/0.06),transparent_60%)]" />
          <div className="relative flex items-end justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald to-emerald/60 flex items-center justify-center shadow-glow-sm">
                  <Sparkle size={13} weight="fill" className="text-white" />
                </div>
                <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Spaces</h1>
              </div>
              <p className="text-[13px] text-muted-foreground/70 leading-relaxed max-w-md">
                Codebase-aware workspaces. Attach folders, ask questions, and get
                prompts tuned to your code.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="relative flex items-center">
                <MagnifyingGlass
                  size={13}
                  weight="bold"
                  className="absolute left-3 text-muted-foreground/40 pointer-events-none"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search spaces"
                  className="h-9 w-56 pl-8 pr-3 text-[12px] bg-card/40 border border-border/30 rounded-xl outline-none focus:border-border/60 focus:bg-card/60 transition-colors text-foreground placeholder:text-muted-foreground/40"
                />
              </div>
              <Button
                size="sm"
                className="h-9 px-4 text-[12px] font-semibold gap-1.5 bg-emerald hover:bg-emerald/90 text-white rounded-xl shadow-glow-sm"
                onClick={() => setIsCreating(true)}
              >
                <Plus size={13} weight="bold" />
                New Space
              </Button>
            </div>
          </div>

          {/* Stat pills */}
          <div className="relative flex items-center gap-2 mt-5 text-[11px] text-muted-foreground/60 font-medium">
            <span className="px-2.5 py-1 rounded-full bg-card/40 border border-border/20">
              {spaces.length} {spaces.length === 1 ? "space" : "spaces"}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-card/40 border border-border/20">
              {totalProjects} {totalProjects === 1 ? "project" : "projects"}
            </span>
          </div>
        </div>

        {/* ── Grid ──────────────────────────────────── */}
        <div className="px-10 pb-10">
          {filteredAndSorted.length === 0 && !isCreating && search.trim() ? (
            <div className="rounded-2xl border border-dashed border-border/30 bg-card/20 py-14 text-center">
              <p className="text-[13px] text-muted-foreground/60">
                No spaces match <span className="text-foreground font-medium">&ldquo;{search}&rdquo;</span>
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Inline create card */}
              {isCreating && (
                <div className="rounded-2xl border-2 border-dashed border-emerald/40 bg-emerald/[0.04] p-5 flex flex-col">
                  <div className="w-11 h-11 rounded-xl bg-emerald/15 flex items-center justify-center mb-4">
                    <Plus size={18} weight="bold" className="text-emerald" />
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
                    className="h-9 text-[13px] bg-background/60 border-border/40 rounded-lg mb-3"
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
              {filteredAndSorted.map((space) => (
                <SpaceCard
                  key={space.id}
                  space={space}
                  isRenaming={renamingId === space.id}
                  renameValue={renameValue}
                  onSelect={onSelectSpace}
                  onStartRename={handleStartRename}
                  onCommitRename={handleCommitRename}
                  onCancelRename={handleCancelRename}
                  onChangeRenameValue={setRenameValue}
                  onRequestDelete={handleRequestDelete}
                  renameInputRef={renameInputRef}
                />
              ))}
            </div>
          )}
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
              <span className="font-medium text-foreground">&ldquo;{deleteTarget?.name}&rdquo;</span>,
              its prompt history, and the project indexes it created on the server
              will be permanently deleted. Your project folders on disk are not affected.
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

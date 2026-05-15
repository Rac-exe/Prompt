import { useState, useRef, useEffect, useMemo, memo, useCallback } from "react";
import {
  Plus, DotsThree, Trash, PencilSimple,
  Clock, MagnifyingGlass, Folder,
  FolderPlus, ChatCircleText, X, CircleNotch,
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
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Space } from "./types";
import { IndexingProgressBar } from "./IndexingProgressBar";

interface SpacesListProps {
  spaces: Space[];
  activeSpaceId: string | null;
  /** projectId → live index_status, kept in sync with the workspace via
   *  the global project:status-update broadcast. The card status dot reads
   *  from this so it never drifts from what you'd see inside the space. */
  projectStatusMap: Record<string, string>;
  onSelectSpace: (id: string) => void;
  /** Opens native folder dialog, derives name from folder, creates + opens space. */
  onCreateSpace: () => void;
  onRenameSpace: (id: string, name: string) => void;
  onDeleteSpace: (id: string) => void;
  /** True while a space creation is in-flight (folder dialog open or backend processing). */
  isCreating?: boolean;
}

// Visual treatment for the space's "summary" status. Green = ready,
// amber pulse = indexing, red = stale/error, neutral = no folder yet.
const STATUS_DOT: Record<string, { dot: string; ring: string; label: string }> = {
  ready:    { dot: "bg-emerald-400",    ring: "ring-emerald-400/20", label: "Ready" },
  indexing: { dot: "bg-amber-400",      ring: "ring-amber-400/20",   label: "Indexing" },
  stale:    { dot: "bg-red-400",        ring: "ring-red-400/20",     label: "Stale" },
  error:    { dot: "bg-red-400",        ring: "ring-red-400/20",     label: "Error" },
  empty:    { dot: "bg-muted-foreground/30", ring: "ring-muted-foreground/10", label: "No folder" },
};

/** Resolve the visible status of a space — uses the live map first, then
 *  the persisted indexStatus on the project entry as a fallback. */
function spaceStatus(space: Space, statusMap: Record<string, string>): keyof typeof STATUS_DOT {
  const proj = space.projects[0];
  if (!proj) return "empty";
  const live = statusMap[proj.projectId];
  const raw = (live || proj.indexStatus || "stale").toLowerCase();
  if (raw === "ready" || raw === "indexing" || raw === "error") return raw;
  return "stale";
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

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || trimmed[0].toUpperCase();
}

// ── Memoized space card ────────────────────────────────────────────────────
// Without memoization every keystroke in the search box re-renders all cards,
// which became visibly laggy past ~20 spaces. Status is passed as a resolved
// string (rather than the whole map) so a status change for *one* project
// doesn't bust the memo of every other card.
interface SpaceCardProps {
  space: Space;
  status: keyof typeof STATUS_DOT;
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
  status,
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
  const letters = useMemo(() => initials(space.name), [space.name]);
  const projectCount = space.projects.length;
  const messageCount = space.messages.length;
  const statusMeta = STATUS_DOT[status];

  return (
    <div
      onClick={() => !isRenaming && onSelect(space.id)}
      className={cn(
        "group relative rounded-xl border border-border/40 bg-card/30",
        "hover:border-border/70 hover:bg-card/55",
        "p-3.5 cursor-pointer transition-all duration-150",
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Tight monogram tile — no gradient, just a subtle tinted square */}
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
            "bg-muted/40 text-foreground/80 text-[11px] font-bold tracking-tight",
            "border border-border/30",
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
                className="h-7 text-[13px] font-semibold bg-background/70 border-border/50 rounded-md"
                maxLength={40}
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5" title={statusMeta.label}>
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0 ring-2 ring-offset-0",
                  statusMeta.dot,
                  statusMeta.ring,
                  status === "indexing" && "animate-pulse",
                )}
              />
              <h3 className="text-[13px] font-semibold text-foreground truncate leading-tight">
                {space.name}
              </h3>
            </div>
          )}
          <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground/55 mt-0.5">
            <Clock size={9} weight="bold" />
            <span>{relativeTime(space.lastUsedAt)}</span>
          </div>
        </div>

        {/* Context menu — visible on card focus/hover */}
        <div
          className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 -mr-1 -mt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground/55 hover:text-foreground hover:bg-muted/40 transition-colors"
                aria-label="Space options"
              >
                <DotsThree size={14} weight="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36 rounded-lg shadow-elevated border-border/40">
              <DropdownMenuItem
                className="text-xs gap-2 cursor-pointer rounded-md"
                onClick={() => onStartRename(space.id, space.name)}
              >
                <PencilSimple size={12} />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs gap-2 cursor-pointer text-destructive focus:text-destructive rounded-md"
                onClick={() => onRequestDelete(space)}
              >
                <Trash size={12} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats row — compact, no chunky pills */}
      <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground/55 font-medium mt-2.5 ml-[42px]">
        <span className="flex items-center gap-1">
          <Folder size={10} weight="duotone" />
          {projectCount === 0 ? "No folder" : projectCount === 1 ? "1 folder" : `${projectCount} folders`}
        </span>
        {messageCount > 0 && (
          <span className="flex items-center gap-1">
            <ChatCircleText size={10} weight="duotone" />
            {messageCount}
          </span>
        )}
      </div>

      {/* Bottom-anchored indeterminate bar — flush with the card's lower
          edge so the motion reads as "this card is working" without
          stealing attention from the title/stats above. Only rendered
          while indexing; other states rely on the status dot beside the
          title. */}
      {status === "indexing" && (
        <div className="absolute bottom-0 left-3 right-3 pb-1.5">
          <IndexingProgressBar variant="block" />
        </div>
      )}
    </div>
  );
});

// ── Create-Space modal ─────────────────────────────────────────────────────
interface CreateSpaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
}

const SUGGESTED_NAMES = ["Work project", "Side hustle", "Research", "Learning"];

const CreateSpaceModal = ({ open, onOpenChange, onCreate }: CreateSpaceModalProps) => {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      const id = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
  }, [open]);

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed) return;
    onCreate(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-card border-border/40 rounded-2xl shadow-elevated max-w-md p-0 overflow-hidden gap-0"
      >
        <div className="px-6 pt-6 pb-4 border-b border-border/15">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-muted/40 border border-border/30 flex items-center justify-center flex-shrink-0">
              <FolderPlus size={16} weight="duotone" className="text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-[15px] font-semibold text-foreground tracking-tight">
                Create a new space
              </DialogTitle>
              <DialogDescription className="text-[12px] text-muted-foreground/65 mt-0.5 leading-relaxed">
                Group prompts and a project folder into one workspace.
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">
              Name
            </label>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submit(); }
                if (e.key === "Escape") onOpenChange(false);
              }}
              placeholder="e.g. Healthcare API rewrite"
              className="mt-1.5 h-10 text-[13px] bg-background/60 border-border/50 rounded-lg focus-visible:ring-1 focus-visible:ring-emerald/40"
              maxLength={40}
            />
            <div className="flex items-center justify-between mt-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {SUGGESTED_NAMES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setName(s)}
                    className="text-[10.5px] px-2 py-0.5 rounded-md bg-muted/40 text-muted-foreground/70 hover:text-foreground hover:bg-muted/70 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground/40 tabular-nums">{name.length}/40</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/15 bg-muted/15">
          <Button
            variant="ghost"
            className="h-9 px-4 text-[12.5px] font-medium text-muted-foreground hover:text-foreground rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="h-9 px-4 text-[12.5px] font-semibold bg-emerald hover:bg-emerald/90 text-white rounded-lg shadow-glow-sm disabled:opacity-40 disabled:shadow-none"
            onClick={submit}
            disabled={!trimmed}
          >
            Create space
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const SpacesList = ({
  spaces, projectStatusMap, onSelectSpace,
  onCreateSpace, onRenameSpace, onDeleteSpace,
  isCreating = false,
}: SpacesListProps) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Space | null>(null);
  const [search, setSearch] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) {
      const id = setTimeout(() => renameInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [renamingId]);

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
        {/* ── Header ──────────────────────────────────── */}
        <div className="px-10 pt-9 pb-5">
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-[19px] font-semibold text-foreground tracking-tight">Spaces</h1>
              <p className="text-[12px] text-muted-foreground/50 mt-0.5">
                {spaces.length} {spaces.length === 1 ? "space" : "spaces"} · {totalProjects} {totalProjects === 1 ? "folder" : "folders"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {spaces.length > 4 && (
                <div className="relative flex items-center">
                  <MagnifyingGlass
                    size={12}
                    weight="bold"
                    className="absolute left-2.5 text-muted-foreground/40 pointer-events-none"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search"
                    className="h-8 w-40 pl-7 pr-3 text-[12px] bg-card/40 border border-border/30 rounded-lg outline-none focus:border-border/60 focus:bg-card/60 transition-colors text-foreground placeholder:text-muted-foreground/40"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute right-2 text-muted-foreground/40 hover:text-foreground"
                      aria-label="Clear search"
                    >
                      <X size={10} weight="bold" />
                    </button>
                  )}
                </div>
              )}
              <Button
                size="sm"
                className="h-8 px-3 text-[12px] font-semibold gap-1.5 bg-foreground hover:bg-foreground/90 text-background rounded-lg"
                onClick={onCreateSpace}
                disabled={isCreating}
              >
                {isCreating ? <CircleNotch size={12} className="animate-spin" /> : <Plus size={12} weight="bold" />}
                New space
              </Button>
            </div>
          </div>
        </div>

        {/* ── Grid ──────────────────────────────────── */}
        <div className="px-10 pb-10">
          {filteredAndSorted.length === 0 && search.trim() ? (
            <div className="rounded-2xl border border-dashed border-border/30 bg-card/20 py-14 text-center">
              <p className="text-[13px] text-muted-foreground/60">
                No spaces match <span className="text-foreground font-medium">&ldquo;{search}&rdquo;</span>
              </p>
            </div>
          ) : (
            // Tighter, denser grid. Cards are now ~half the previous footprint
            // so a typical user can see 6–10 spaces at a glance instead of 3.
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
              {isCreating && (
                <div className="rounded-xl border border-border/30 bg-card/20 p-3.5 animate-pulse">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-muted/50" />
                    <div className="flex-1 min-w-0 space-y-2 pt-0.5">
                      <div className="h-3 w-24 rounded bg-muted/40" />
                      <div className="h-2 w-14 rounded bg-muted/30" />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-3 ml-[42px]">
                    <div className="h-2 w-16 rounded bg-muted/30" />
                  </div>
                </div>
              )}
              {filteredAndSorted.map((space) => (
                <SpaceCard
                  key={space.id}
                  space={space}
                  status={spaceStatus(space, projectStatusMap)}
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

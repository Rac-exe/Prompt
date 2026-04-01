import { useState, useMemo } from "react";
import * as Sentry from "@sentry/react";
import {
  FolderPlus, Star, Folder, DotsThreeVertical,
  PencilSimple, Trash, Books, MagnifyingGlass, ShareNetwork, Link,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PromptCard, SavedPrompt } from "./PromptCard";
import { ShareCollectionModal } from "./ShareCollectionModal";

/**
 * Parses a prmpt:// share link entirely client-side and returns the
 * React Router route path to navigate to, or null if invalid.
 *
 * Uses plain string parsing instead of new URL() — custom schemes like
 * prmpt:// can behave inconsistently across environments with the URL API.
 *
 * Expected shapes:
 *   prmpt://share/c/<hmac_token>   → /share/c/<token>  (collection)
 *   prmpt://share/p/<hmac_token>   → /share/p/<token>  (prompt)
 */
function parseShareLink(input: string): string | null {
  try {
    const trimmed = input.trim();
    const PREFIX = 'prmpt://share/';
    if (!trimmed.toLowerCase().startsWith(PREFIX)) return null;

    const rest = trimmed.slice(PREFIX.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx === -1) return null;

    const type = rest.slice(0, slashIdx);
    const token = rest.slice(slashIdx + 1).trim();

    if (type !== 'c' && type !== 'p') return null;
    // Matches randomBytes(24).toString('base64url') — 32 base64url chars
    if (!/^[A-Za-z0-9_-]{20,50}$/.test(token)) return null;

    return `/share/${type}/${token}`;
  } catch {
    return null;
  }
}

export interface Collection {
  id: string;
  name: string;
  isDefault?: boolean;
  icon?: "all" | "favorites" | "folder";
  originalCreatorName?: string;
}

interface PromptLibraryProps {
  collections: Collection[];
  prompts: SavedPrompt[];
  onCreateCollection: (name: string) => void;
  onRenameCollection: (id: string, name: string) => void;
  onDeleteCollection: (id: string) => void;
  onCopyPrompt: (id: string) => void;
  onEditPrompt: (promptId: string, title: string, collectionId: string) => Promise<void>;
  onDeletePrompt: (id: string) => void;
  onOpenPrompt?: (id: string) => void;
}

export const PromptLibrary = ({
  collections, prompts, onCreateCollection, onRenameCollection,
  onDeleteCollection, onCopyPrompt, onEditPrompt, onDeletePrompt, onOpenPrompt,
}: PromptLibraryProps) => {
  const navigate = useNavigate();
  const [selectedCollection, setSelectedCollection] = useState<string>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [shareModalCollection, setShareModalCollection] = useState<Collection | null>(null);
  const [openLinkDialogOpen, setOpenLinkDialogOpen] = useState(false);
  const [pastedLink, setPastedLink] = useState("");
  const [linkError, setLinkError] = useState("");

  const handleOpenSharedLink = () => {
    setLinkError("");
    const route = parseShareLink(pastedLink);
    if (!route) {
      Sentry.captureMessage("Invalid pasted share link format", "warning");
      setLinkError("Invalid link. Make sure you copied the full prmpt://share/c/... link from the Share modal.");
      return;
    }
    Sentry.addBreadcrumb({
      category: "sharing",
      message: "Opened shared link from pasted input",
      level: "info",
      data: { routePath: route },
    });
    setOpenLinkDialogOpen(false);
    setPastedLink("");
    setLinkError("");
    navigate(route);
  };

  const handleCreateCollection = () => {
    if (newCollectionName.trim()) {
      onCreateCollection(newCollectionName.trim());
      setNewCollectionName("");
      setIsCreating(false);
    }
  };

  const handleRename = (id: string) => {
    if (editName.trim()) {
      onRenameCollection(id, editName.trim());
      setEditingId(null);
      setEditName("");
    }
  };

  const filteredPrompts = useMemo(() => {
    let result =
      selectedCollection === "all" ? prompts
      : selectedCollection === "favorites" ? prompts.filter((p) => p.isFavorite)
      : prompts.filter((p) => p.collectionId === selectedCollection);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)
      );
    }
    return result;
  }, [prompts, selectedCollection, searchQuery]);

  const getCollectionIcon = (collection: Collection) => {
    if (collection.icon === "all") return Books;
    if (collection.icon === "favorites") return Star;
    return Folder;
  };

  const currentCollectionName =
    collections.find((c) => c.id === selectedCollection)?.name || "All Prompts";

  return (
    <>
    <div className="flex-1 flex h-full bg-background">
      {/* ── Collections sidebar ────────────────────────────── */}
      <div className="w-[220px] flex-shrink-0 border-r border-border flex flex-col bg-sidebar">
        {/* Header */}
        <div className="px-4 py-4 border-b border-sidebar-border flex-shrink-0">
          <h2 className="text-[13px] font-bold text-foreground tracking-tight">Prompt Library</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {prompts.length} saved prompt{prompts.length !== 1 ? "s" : ""}
          </p>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {/* Create collection */}
            {isCreating ? (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Folder size={14} weight="light" className="text-muted-foreground flex-shrink-0" />
                <Input
                  placeholder="Collection name"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  onBlur={() => {
                    if (!newCollectionName.trim()) setIsCreating(false);
                    else handleCreateCollection();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateCollection();
                    if (e.key === "Escape") setIsCreating(false);
                  }}
                  className="h-6 text-xs bg-sidebar-accent border-emerald/40 focus-visible:ring-emerald/20"
                  autoFocus
                  data-testid="new-collection-name-input"
                />
              </div>
            ) : (
              <button
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium text-emerald hover:bg-sidebar-accent transition-smooth mb-1"
                onClick={() => setIsCreating(true)}
                data-testid="create-collection-button"
              >
                <FolderPlus size={14} weight="light" className="flex-shrink-0" />
                New Collection
              </button>
            )}

            {/* Open shared link */}
            <button
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-smooth mb-1"
              onClick={() => { setPastedLink(""); setLinkError(""); setOpenLinkDialogOpen(true); }}
              data-testid="open-share-link-button"
            >
              <Link size={14} weight="light" className="flex-shrink-0" />
              Open Shared Link
            </button>

            {/* Collection list */}
            {collections.map((collection) => {
              const Icon = getCollectionIcon(collection);
              const isSelected = selectedCollection === collection.id;
              const isEditing = editingId === collection.id;

              return (
                <div
                  key={collection.id}
                  className={cn(
                    "group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-smooth",
                    isSelected
                      ? "bg-sidebar-accent text-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  )}
                  onClick={() => !isEditing && setSelectedCollection(collection.id)}
                  data-testid={`collection-${collection.id}`}
                >
                  <Icon size={14} weight="light" className={cn("flex-shrink-0", isSelected && "text-emerald")} />

                  {isEditing ? (
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => handleRename(collection.id)}
                      onKeyDown={(e) => e.key === "Enter" && handleRename(collection.id)}
                      className="h-5 text-xs bg-sidebar-accent border-emerald/40 focus-visible:ring-emerald/20 py-0"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="flex-1 min-w-0">
                      <span className={cn("block text-[13px] truncate font-medium", isSelected && "text-foreground")}>
                        {collection.name}
                      </span>
                      {collection.originalCreatorName && (
                        <span className="block text-[10px] text-muted-foreground/60 truncate">
                          by {collection.originalCreatorName}
                        </span>
                      )}
                    </div>
                  )}

                  {!collection.isDefault && !isEditing && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost" size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-smooth text-muted-foreground hover:text-foreground rounded-md"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DotsThreeVertical size={12} weight="light" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-popover border-border shadow-elevated rounded-xl w-40 p-1"
                      >
                        <DropdownMenuItem
                          className="text-xs text-foreground focus:bg-secondary gap-2 rounded-lg cursor-pointer font-medium"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShareModalCollection(collection);
                          }}
                        >
                          <ShareNetwork size={12} weight="light" className="opacity-60" />
                          Share Library
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-xs text-foreground focus:bg-secondary gap-2 rounded-lg cursor-pointer font-medium"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(collection.id);
                            setEditName(collection.name);
                          }}
                        >
                          <PencilSimple size={12} weight="light" className="opacity-60" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-xs text-destructive focus:bg-destructive/8 focus:text-destructive gap-2 rounded-lg cursor-pointer font-medium"
                          onClick={(e) => { e.stopPropagation(); onDeleteCollection(collection.id); }}
                        >
                          <Trash size={12} weight="light" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* ── Prompts panel ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Panel header */}
        <div className="px-5 py-4 border-b border-border flex-shrink-0 bg-surface/30">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <h3 className="text-base font-bold text-foreground tracking-tight">{currentCollectionName}</h3>
              {/* Show original creator attribution if this is a saved/forked collection */}
              {(() => {
                const col = collections.find((c) => c.id === selectedCollection);
                return col?.originalCreatorName ? (
                  <p className="text-[11px] text-emerald/80 mt-0.5 flex items-center gap-1">
                    Original library by{" "}
                    <span className="font-semibold">{col.originalCreatorName}</span>
                  </p>
                ) : null;
              })()}
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {filteredPrompts.length} prompt{filteredPrompts.length !== 1 ? "s" : ""}
                {searchQuery && " matching"}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <MagnifyingGlass size={14} weight="light" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              placeholder="Search by title or content…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-surface border-border text-sm focus-visible:border-emerald/50 focus-visible:ring-emerald/15 placeholder:text-muted-foreground/70 transition-smooth"
              data-testid="search-prompts-input"
            />
          </div>
        </div>

        {/* Prompt grid */}
        <ScrollArea className="flex-1">
          <div className="p-5">
            {filteredPrompts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
                <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
                  <Books size={24} weight="light" className="text-muted-foreground/40" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  {searchQuery ? "No matching prompts" : "No prompts yet"}
                </p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  {searchQuery
                    ? "Try a different search term or clear the filter"
                    : "Save prompts from chat conversations to build your library"}
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredPrompts.map((prompt) => (
                  <PromptCard
                    key={prompt.id}
                    prompt={prompt}
                    collections={collections.filter((c) => !c.isDefault)}
                    onCopy={() => onCopyPrompt(prompt.id)}
                    onEdit={onEditPrompt}
                    onDelete={onDeletePrompt}
                    onOpen={() => onOpenPrompt?.(prompt.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>

    {/* Share Collection Modal */}
    {shareModalCollection && (
      <ShareCollectionModal
        open={!!shareModalCollection}
        onOpenChange={(open) => { if (!open) setShareModalCollection(null); }}
        collection={{ id: shareModalCollection.id, name: shareModalCollection.name }}
      />
    )}

    {/* Open Shared Link Dialog */}
    <Dialog open={openLinkDialogOpen} onOpenChange={(open) => { setOpenLinkDialogOpen(open); if (!open) { setPastedLink(""); setLinkError(""); } }}>
      <DialogContent className="sm:max-w-[460px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Link size={16} weight="light" className="text-emerald" />
            Open Shared Link
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Paste a <span className="font-mono text-foreground text-xs">prmpt://</span> share link to view a shared collection or prompt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <Input
            placeholder="prmpt://share/c/..."
            value={pastedLink}
            onChange={(e) => { setPastedLink(e.target.value); setLinkError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleOpenSharedLink()}
            className="bg-secondary border-border font-mono text-xs"
            autoFocus
          />
          {linkError && (
            <p className="text-xs text-destructive">{linkError}</p>
          )}
          <Button
            onClick={handleOpenSharedLink}
            disabled={!pastedLink.trim()}
            className="w-full bg-emerald text-white hover:bg-emerald/90 font-semibold"
          >
            Open
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>
  );
};

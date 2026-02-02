import { useState, useMemo } from "react";
import {
  FolderPlus,
  Star,
  Folder,
  MoreVertical,
  Pencil,
  Trash2,
  Library,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { cn } from "@/lib/utils";
import { PromptCard, SavedPrompt } from "./PromptCard.tsx";
import { SharePromptModal } from "./SharePromptModal.tsx";

export interface Collection {
  id: string;
  name: string;
  isDefault?: boolean;
  icon?: "all" | "favorites" | "folder";
}

interface PromptLibraryProps {
  collections: Collection[];
  prompts: SavedPrompt[];
  onCreateCollection: (name: string) => void;
  onRenameCollection: (id: string, name: string) => void;
  onDeleteCollection: (id: string) => void;
  onCopyPrompt: (id: string) => void;
  onEditPrompt: (id: string) => void;
  onDeletePrompt: (id: string) => void;
  onOpenPrompt?: (id: string) => void;
}

export const PromptLibrary = ({
  collections,
  prompts,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onCopyPrompt,
  onEditPrompt,
  onDeletePrompt,
  onOpenPrompt,
}: PromptLibraryProps) => {
  const [selectedCollection, setSelectedCollection] = useState<string>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [promptToShare, setPromptToShare] = useState<SavedPrompt | null>(null);

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

  // Filtered and searched prompts
  const filteredPrompts = useMemo(() => {
    let result =
      selectedCollection === "all"
        ? prompts
        : selectedCollection === "favorites"
        ? prompts.filter((p) => p.isFavorite)
        : prompts.filter((p) => p.collectionId === selectedCollection);

    // Apply search filter with debouncing effect (handled by useMemo)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(query) ||
          p.content.toLowerCase().includes(query)
      );
    }

    return result;
  }, [prompts, selectedCollection, searchQuery]);

  const getCollectionIcon = (collection: Collection) => {
    if (collection.icon === "all") return Library;
    if (collection.icon === "favorites") return Star;
    return Folder;
  };

  return (
    <div className="flex-1 flex h-full">
      {/* Collections sidebar */}
      <div className="w-64 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Prompt Library
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage your saved prompts
          </p>
        </div>

        <ScrollArea className="flex-1 p-3">
          <div className="space-y-1">
            {/* Create new collection - AT TOP */}
            {isCreating ? (
              <div className="flex items-center gap-2 px-3 py-2 mb-2">
                <Folder className="w-4 h-4 text-muted-foreground" />
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
                  className="h-6 text-sm bg-background"
                  autoFocus
                  data-testid="new-collection-name-input"
                />
              </div>
            ) : (
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 text-emerald hover:text-emerald hover:bg-sidebar-accent/50 transition-button mb-2"
                onClick={() => setIsCreating(true)}
                data-testid="create-collection-button"
              >
                <FolderPlus className="w-4 h-4" />
                New Collection
              </Button>
            )}

            {collections.map((collection) => {
              const Icon = getCollectionIcon(collection);
              const isSelected = selectedCollection === collection.id;
              const isEditing = editingId === collection.id;

              return (
                <div
                  key={collection.id}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-button",
                    isSelected
                      ? "bg-secondary text-emerald"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  )}
                  onClick={() => !isEditing && setSelectedCollection(collection.id)}
                  data-testid={`collection-${collection.id}`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  
                  {isEditing ? (
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => handleRename(collection.id)}
                      onKeyDown={(e) => e.key === "Enter" && handleRename(collection.id)}
                      className="h-6 text-sm bg-background"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 text-sm truncate">{collection.name}</span>
                  )}

                  {!collection.isDefault && !isEditing && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="w-3 h-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-card border-border"
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(collection.id);
                            setEditName(collection.name);
                          }}
                        >
                          <Pencil className="w-4 h-4 mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteCollection(collection.id);
                          }}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
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

      {/* Prompts list */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-border bg-surface/50">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {collections.find((c) => c.id === selectedCollection)?.name || "All Prompts"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {filteredPrompts.length} prompt{filteredPrompts.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search prompts by title or content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-secondary border-border"
              data-testid="search-prompts-input"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-3">
            {filteredPrompts.length === 0 ? (
              <div className="text-center py-12">
                <Library className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  {searchQuery ? "No prompts match your search" : "No prompts saved yet"}
                </p>
                <p className="text-sm text-muted-foreground/70">
                  {searchQuery ? "Try a different search term" : "Save prompts from chat to see them here"}
                </p>
              </div>
            ) : (
              filteredPrompts.map((prompt) => (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  onCopy={() => onCopyPrompt(prompt.id)}
                  onEdit={() => onEditPrompt(prompt.id)}
                  onDelete={() => onDeletePrompt(prompt.id)}
                  onOpen={() => onOpenPrompt?.(prompt.id)}
                  onShare={() => {
                    setPromptToShare(prompt);
                    setShareModalOpen(true);
                  }}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
      
      {/* Share Modal */}
      {promptToShare && (
        <SharePromptModal
          open={shareModalOpen}
          onClose={() => {
            setShareModalOpen(false);
            setPromptToShare(null);
          }}
          promptTitle={promptToShare.title}
          promptContent={promptToShare.content}
        />
      )}
    </div>
  );
};

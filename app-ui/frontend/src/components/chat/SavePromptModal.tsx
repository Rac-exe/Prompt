import { useState } from "react";
import { X, FolderPlus, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SavePromptModalProps {
  open: boolean;
  onClose: () => void;
  collections: { id: string; name: string }[];
  onSave: (collectionId: string, title: string, newCollectionName?: string) => void;
  promptPreview: string;
}

export const SavePromptModal = ({
  open,
  onClose,
  collections,
  onSave,
  promptPreview,
}: SavePromptModalProps) => {
  const [selectedCollection, setSelectedCollection] = useState<string>("");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [promptTitle, setPromptTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    if (!promptTitle.trim()) {
      return;
    }

    setIsSaving(true);
    setTimeout(() => {
      if (isCreatingNew && newCollectionName.trim()) {
        onSave("new", promptTitle.trim(), newCollectionName.trim());
      } else if (selectedCollection) {
        onSave(selectedCollection, promptTitle.trim());
      }
      setIsSaving(false);
      setPromptTitle("");
      setSelectedCollection("");
      setNewCollectionName("");
      setIsCreatingNew(false);
      onClose();
    }, 500);
  };

  const canSave = promptTitle.trim().length > 0 && 
    (isCreatingNew
      ? newCollectionName.trim().length > 0
      : selectedCollection.length > 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-md z-[100]">
        <DialogHeader>
          <DialogTitle className="text-foreground">Save Prompt</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Prompt Title */}
          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-medium text-foreground">
              Prompt Title
            </Label>
            <Input
              id="title"
              placeholder="e.g., API Documentation Template"
              value={promptTitle}
              onChange={(e) => setPromptTitle(e.target.value)}
              className="bg-secondary border-border"
              autoFocus
              data-testid="prompt-title-input"
            />
          </div>

          {/* Prompt preview */}
          <div className="bg-surface rounded-lg p-3 border border-border max-h-[100px] overflow-y-auto">
            <p className="text-xs text-muted-foreground mb-1">Preview</p>
            <p className="text-sm text-foreground line-clamp-3">{promptPreview}</p>
          </div>

          {/* Collection selector */}
          {!isCreatingNew ? (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">
                Choose collection
              </Label>
              <Select value={selectedCollection} onValueChange={setSelectedCollection}>
                <SelectTrigger className="bg-secondary border-border" data-testid="collection-select">
                  <SelectValue placeholder="Select a collection" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {collections.map((collection) => (
                    <SelectItem key={collection.id} value={collection.id}>
                      {collection.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="ghost"
                size="sm"
                className="text-emerald hover:text-emerald/80 transition-button"
                onClick={() => setIsCreatingNew(true)}
              >
                <FolderPlus className="w-4 h-4 mr-2" />
                Create new collection
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">
                New collection name
              </Label>
              <Input
                placeholder="e.g., Marketing Prompts"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                className="bg-secondary border-border"
                data-testid="new-collection-input"
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground transition-button"
                onClick={() => {
                  setIsCreatingNew(false);
                  setNewCollectionName("");
                }}
              >
                ← Back to collections
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-border"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canSave || isSaving}
              className="flex-1 bg-emerald text-white hover:bg-emerald/90 disabled:opacity-50 transition-button"
              data-testid="save-prompt-confirm-button"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

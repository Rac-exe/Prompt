import { useState, useEffect } from "react";
import { Pencil, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface EditableCollection {
  id: string;
  name: string;
}

interface EditPromptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: {
    id: string;
    title: string;
    collectionId: string;
  };
  collections: EditableCollection[];
  onSave: (promptId: string, title: string, collectionId: string) => Promise<void>;
}

export const EditPromptModal = ({
  open,
  onOpenChange,
  prompt,
  collections,
  onSave,
}: EditPromptModalProps) => {
  const [title, setTitle] = useState(prompt.title);
  const [collectionId, setCollectionId] = useState(prompt.collectionId);
  const [saving, setSaving] = useState(false);

  // Reset fields whenever the modal opens with a (possibly new) prompt
  useEffect(() => {
    if (open) {
      setTitle(prompt.title);
      setCollectionId(prompt.collectionId);
    }
  }, [open, prompt.title, prompt.collectionId]);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave(prompt.id, title.trim(), collectionId);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Pencil className="w-4 h-4 text-emerald" />
            Edit Prompt
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Update the title or move this prompt to a different collection.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-prompt-title" className="text-sm text-foreground">
              Title
            </Label>
            <Input
              id="edit-prompt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="bg-secondary border-border focus-visible:border-emerald/50 focus-visible:ring-emerald/15"
              autoFocus
            />
          </div>

          {/* Collection */}
          <div className="space-y-1.5">
            <Label className="text-sm text-foreground">Collection</Label>
            <Select value={collectionId} onValueChange={setCollectionId}>
              <SelectTrigger className="bg-secondary border-border focus:ring-emerald/15 focus:border-emerald/50">
                <SelectValue placeholder="Select a collection" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {collections.map((col) => (
                  <SelectItem key={col.id} value={col.id} className="focus:bg-secondary">
                    {col.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1 border-border"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-emerald text-white hover:bg-emerald/90"
              onClick={handleSave}
              disabled={saving || !title.trim()}
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

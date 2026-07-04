import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, FolderPlus, Check, CircleNotch } from "@phosphor-icons/react";
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
  // When true, the modal uses a tighter, more rounded layout sized for
  // the 480px overlay panel. Defaults to false (full app dialog).
  compact?: boolean;
}

export const SavePromptModal = ({
  open,
  onClose,
  collections,
  onSave,
  promptPreview,
  compact = false,
}: SavePromptModalProps) => {
  const [selectedCollection, setSelectedCollection] = useState<string>("");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [promptTitle, setPromptTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // When mounted in the overlay we need to portal *inside* the
  // .overlay-panel element. The default Radix portal targets
  // document.body which, on the overlay BrowserWindow, is wider than
  // the visible 480px panel — so the dim backdrop bleeds out past
  // the panel's rounded edge. Rendering inside the panel makes the
  // backdrop respect the panel's `overflow: hidden` and rounded
  // corners. Resolved via querySelector once on mount; if it isn't
  // there yet (StrictMode double-mount, etc.), we fall back to body.
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!compact) return;
    const el = document.querySelector('.overlay-panel') as HTMLElement | null;
    if (el) setPanelEl(el);
  }, [compact]);

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

  // Shared form body — identical fields/spacing whether we render
  // inside the app's full Dialog or the overlay's panel-scoped one.
  const body = (
    <div className={compact ? "space-y-3 mt-1" : "space-y-4 mt-4"}>
          {/* Prompt Title */}
          <div className={compact ? "space-y-1.5" : "space-y-2"}>
            <Label
              htmlFor="title"
              className={
                compact
                  ? "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                  : "text-sm font-medium text-foreground"
              }
            >
              {compact ? "Title" : "Prompt Title"}
            </Label>
            <Input
              id="title"
              placeholder={compact ? "Give your prompt a title…" : "e.g., API Documentation Template"}
              value={promptTitle}
              onChange={(e) => setPromptTitle(e.target.value)}
              className={
                compact
                  ? "bg-secondary border-border h-9 rounded-xl text-sm"
                  : "bg-secondary border-border"
              }
              autoFocus
              data-testid="prompt-title-input"
            />
          </div>

          {/* Prompt preview */}
          <div
            className={
              compact
                ? "bg-surface rounded-xl p-2.5 border border-border max-h-[68px] overflow-y-auto"
                : "bg-surface rounded-lg p-3 border border-border max-h-[100px] overflow-y-auto"
            }
          >
            <p className={compact ? "text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5" : "text-xs text-muted-foreground mb-1"}>
              Preview
            </p>
            <p className={compact ? "text-xs text-foreground line-clamp-2 leading-snug" : "text-sm text-foreground line-clamp-3"}>
              {promptPreview}
            </p>
          </div>

          {/* Collection selector */}
          {!isCreatingNew ? (
            <div className={compact ? "space-y-1.5" : "space-y-2"}>
              <Label
                className={
                  compact
                    ? "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    : "text-sm font-medium text-foreground"
                }
              >
                {compact ? "Collection" : "Choose collection"}
              </Label>
              <Select value={selectedCollection} onValueChange={setSelectedCollection}>
                <SelectTrigger
                  className={
                    compact
                      ? "bg-secondary border-border h-9 rounded-xl text-sm"
                      : "bg-secondary border-border"
                  }
                  data-testid="collection-select"
                >
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
                className={
                  compact
                    ? "text-emerald hover:text-emerald/80 hover:bg-emerald/10 dark:hover:bg-emerald/10 transition-button h-7 px-2 text-xs rounded-lg"
                    : "text-emerald hover:text-emerald/80 hover:bg-emerald/10 dark:hover:bg-emerald/10 transition-button"
                }
                onClick={() => setIsCreatingNew(true)}
              >
                <FolderPlus size={compact ? 14 : 16} weight="light" className={compact ? "mr-1.5" : "mr-2"} />
                {compact ? "New collection" : "Create new collection"}
              </Button>
            </div>
          ) : (
            <div className={compact ? "space-y-1.5" : "space-y-2"}>
              <Label
                className={
                  compact
                    ? "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    : "text-sm font-medium text-foreground"
                }
              >
                {compact ? "New collection" : "New collection name"}
              </Label>
              <Input
                placeholder={compact ? "Name…" : "e.g., Marketing Prompts"}
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                className={
                  compact
                    ? "bg-secondary border-border h-9 rounded-xl text-sm"
                    : "bg-secondary border-border"
                }
                data-testid="new-collection-input"
              />
              <Button
                variant="ghost"
                size="sm"
                className={
                  compact
                    ? "text-muted-foreground hover:text-foreground transition-button h-7 px-2 text-xs rounded-lg"
                    : "text-muted-foreground hover:text-foreground transition-button"
                }
                onClick={() => {
                  setIsCreatingNew(false);
                  setNewCollectionName("");
                }}
              >
                ← Back
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className={compact ? "flex gap-2 pt-1" : "flex gap-2 pt-2"}>
            <Button
              variant="outline"
              onClick={onClose}
              className={
                compact
                  ? "flex-1 border-border h-9 rounded-xl text-xs"
                  : "flex-1 border-border"
              }
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canSave || isSaving}
              className={
                compact
                  ? "flex-1 border border-input text-foreground hover:bg-muted font-semibold disabled:opacity-50 transition-button h-9 rounded-xl text-xs"
                  : "flex-1 border border-input text-foreground hover:bg-muted font-semibold disabled:opacity-50 transition-button"
              }
              data-testid="save-prompt-confirm-button"
            >
              {isSaving ? (
                <CircleNotch size={compact ? 14 : 16} weight="light" className="animate-spin" />
              ) : (
                <>
                  <Check size={compact ? 14 : 16} weight="light" className={compact ? "mr-1.5" : "mr-2"} />
                  Save
                </>
              )}
            </Button>
          </div>
        </div>
  );

  // Compact / overlay branch — Radix primitives directly so we can:
  //   1. Portal into the .overlay-panel (not document.body), so the
  //      backdrop is clipped by the panel's rounded `overflow: hidden`.
  //   2. Use absolute (not fixed) positioning so center math is
  //      panel-relative, not viewport-relative.
  //   3. Tone down the backdrop to a soft tint instead of bg-black/80
  //      and add a tiny blur — much friendlier for a small panel.
  if (compact) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onClose}>
        <DialogPrimitive.Portal container={panelEl ?? undefined}>
          <DialogPrimitive.Overlay
            className="absolute inset-0 z-50 bg-foreground/15 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          />
          <DialogPrimitive.Content
            className="absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[340px] max-w-[calc(100%-32px)] grid gap-2 bg-card border border-border rounded-2xl p-4 shadow-2xl duration-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          >
            <div className="flex items-center justify-between">
              <DialogPrimitive.Title className="text-foreground text-sm font-semibold tracking-tight">
                Save Prompt
              </DialogPrimitive.Title>
              <DialogPrimitive.Close className="rounded-md opacity-60 hover:opacity-100 transition-opacity focus:outline-none">
                <X size={14} weight="light" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
            {body}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">Save Prompt</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

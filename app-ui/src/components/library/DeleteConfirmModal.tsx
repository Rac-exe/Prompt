import { Trash } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeleteConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptTitle: string;
  onConfirm: () => void;
}

export const DeleteConfirmModal = ({
  open,
  onOpenChange,
  promptTitle,
  onConfirm,
}: DeleteConfirmModalProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Trash size={16} weight="light" className="text-destructive" />
            Delete Prompt
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-foreground">"{promptTitle}"</span>?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            className="flex-1 border-border"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

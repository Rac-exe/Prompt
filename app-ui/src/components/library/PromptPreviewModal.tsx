import { useState } from "react";
import { Copy, Check, FileText } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";

interface PromptPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: {
    title: string;
    content: string;
    createdAt?: Date;
    sourceChat?: string;
  };
}

export const PromptPreviewModal = ({ open, onOpenChange, prompt }: PromptPreviewModalProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Copied!",
      description: "Prompt copied to clipboard.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] bg-card border-border p-0 gap-0">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <DialogTitle className="flex items-center gap-2 text-foreground text-xl mb-2">
                <FileText size={20} weight="light" className="text-emerald" />
                {prompt.title}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">
                {prompt.sourceChat && (
                  <span className="mr-3">From: {prompt.sourceChat}</span>
                )}
                {prompt.createdAt && (
                  <span>
                    Created: {prompt.createdAt.toLocaleDateString()}
                  </span>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <ScrollArea className="flex-1 px-6 py-4" style={{ maxHeight: "calc(80vh - 180px)" }}>
          <div className="bg-secondary border border-border rounded-lg p-4">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {prompt.content}
            </p>
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="p-6 pt-4 border-t border-border flex gap-3">
          <Button
            onClick={handleCopy}
            className="flex-1 border border-input text-foreground hover:bg-muted font-semibold transition-button"
          >
            {copied ? (
              <>
                <Check size={16} weight="light" className="mr-2" />
                Copied!
              </>
            ) : (
              <>
                <Copy size={16} weight="light" className="mr-2" />
                Copy to Clipboard
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

import { useState } from "react";
import { X, Copy, Check, Download, Mail } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { toast } from "@/hooks/use-toast";

interface SharePromptModalProps {
  open: boolean;
  onClose: () => void;
  promptTitle: string;
  promptContent: string;
}

export const SharePromptModal = ({
  open,
  onClose,
  promptTitle,
  promptContent,
}: SharePromptModalProps) => {
  const [copied, setCopied] = useState(false);
  
  const shareText = `${promptTitle}\n\n${promptContent}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Copied to clipboard",
      description: "Prompt text copied successfully",
    });
  };

  const handleDownload = () => {
    const blob = new Blob([shareText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${promptTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: "Downloaded",
      description: "Prompt saved as .txt file",
    });
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(promptTitle);
    const body = encodeURIComponent(promptContent);
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center justify-between">
            <span>Share Prompt</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-6 w-6"
            >
              <X className="w-4 h-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Prompt preview */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">{promptTitle}</h4>
            <Textarea
              value={promptContent}
              readOnly
              className="min-h-[200px] bg-secondary border-border resize-none"
              data-testid="share-prompt-preview"
            />
          </div>

          {/* Share actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleCopy}
              className={copied ? "bg-emerald text-white" : "bg-secondary text-foreground hover:bg-secondary/80"}
              data-testid="share-copy-button"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Text
                </>
              )}
            </Button>

            <Button
              onClick={handleDownload}
              variant="outline"
              className="border-border"
              data-testid="share-download-button"
            >
              <Download className="w-4 h-4 mr-2" />
              Download .txt
            </Button>

            <Button
              onClick={handleEmail}
              variant="outline"
              className="border-border"
              data-testid="share-email-button"
            >
              <Mail className="w-4 h-4 mr-2" />
              Share via Email
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

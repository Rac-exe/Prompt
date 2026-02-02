import { useState } from "react";
import { Copy, Check, Pencil, Trash2, Calendar, MessageSquare, Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { SharePromptModal } from "./SharePromptModal";

export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  collectionId: string;
  sourceChat?: string;
  createdAt: Date;
  isFavorite?: boolean;
}

interface PromptCardProps {
  prompt: SavedPrompt;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpen?: () => void;
}

export const PromptCard = ({ prompt, onCopy, onEdit, onDelete, onOpen }: PromptCardProps) => {
  const [copied, setCopied] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(prompt.content);
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = new Blob([prompt.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${prompt.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: "Downloaded",
      description: "Prompt saved as .txt file",
    });
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShareModalOpen(true);
  };

  const handleCardClick = () => {
    if (onOpen) {
      onOpen();
    }
  };

  return (
    <div
      className={cn(
        "group bg-surface border border-border rounded-xl p-4 transition-all animate-fade-in",
        onOpen && "cursor-pointer hover:border-emerald/50 hover:bg-surface-hover"
      )}
      onClick={handleCardClick}
      data-testid={`prompt-card-${prompt.id}`}
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <h4 className="font-medium text-foreground line-clamp-1">{prompt.title}</h4>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 transition-button",
              copied ? "text-emerald" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={handleCopy}
            data-testid="prompt-copy-button"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground transition-button"
            onClick={handleDownload}
            data-testid="prompt-download-button"
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground transition-button"
            onClick={handleShare}
            data-testid="prompt-share-button"
          >
            <Share2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground transition-button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            data-testid="prompt-edit-button"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive transition-button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            data-testid="prompt-delete-button"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
        {prompt.content}
      </p>

      <div className="flex items-center gap-4 text-xs text-muted-foreground/70">
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>{prompt.createdAt.toLocaleDateString()}</span>
        </div>
        {prompt.sourceChat && (
          <div className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            <span className="truncate max-w-[150px]">{prompt.sourceChat}</span>
          </div>
        )}
      </div>

      <SharePromptModal
        open={shareModalOpen}
        onOpenChange={setShareModalOpen}
        prompt={{ title: prompt.title, content: prompt.content }}
      />
    </div>
  );
};

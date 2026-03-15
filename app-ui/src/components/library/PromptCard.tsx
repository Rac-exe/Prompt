import { useState } from "react";
import { Copy, Check, Pencil, Trash2, Calendar, MessageSquare, Download, User, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { EditPromptModal, EditableCollection } from "./EditPromptModal";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { SharePromptLinkModal } from "./SharePromptLinkModal";

export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  collectionId: string;
  sourceChat?: string;
  createdAt: Date;
  isFavorite?: boolean;
  /** Set when this prompt belongs to a library forked from another user */
  originalCreatorName?: string;
}

interface PromptCardProps {
  prompt: SavedPrompt;
  collections: EditableCollection[];
  onCopy: () => void;
  onEdit: (promptId: string, title: string, collectionId: string) => Promise<void>;
  onDelete: (id: string) => void;
  onOpen?: () => void;
}

export const PromptCard = ({ prompt, collections, onCopy, onEdit, onDelete, onOpen }: PromptCardProps) => {
  const [copied, setCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

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
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${prompt.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: "Prompt saved as .txt file" });
  };

  return (
    <>
      <div
        className={cn(
          "group relative bg-surface border border-border rounded-xl p-4 transition-smooth animate-fade-in",
          onOpen && "cursor-pointer hover:border-emerald/40 hover:shadow-card-hover"
        )}
        onClick={onOpen}
        data-testid={`prompt-card-${prompt.id}`}
      >
        {/* Top row */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h4 className="text-[13px] font-semibold text-foreground line-clamp-1 flex-1 min-w-0 leading-snug">
            {prompt.title}
          </h4>

          {/* Actions — revealed on hover */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-smooth flex-shrink-0">
            <Button
              variant="ghost" size="icon"
              className={cn(
                "h-6 w-6 rounded-md transition-smooth",
                copied ? "text-emerald" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              onClick={handleCopy}
              data-testid="prompt-copy-button"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth"
              onClick={handleDownload}
              data-testid="prompt-download-button"
            >
              <Download className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth"
              onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
              data-testid="prompt-share-button"
              title="Share prompt"
            >
              <Share2 className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth"
              onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
              data-testid="prompt-edit-button"
            >
              <Pencil className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-smooth"
              onClick={(e) => { e.stopPropagation(); setDeleteOpen(true); }}
              data-testid="prompt-delete-button"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Content preview */}
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-relaxed">
          {prompt.content}
        </p>

        {/* Meta row */}
        <div className="flex items-center gap-3.5 flex-wrap">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
            <Calendar className="w-2.5 h-2.5" />
            <span>{prompt.createdAt.toLocaleDateString()}</span>
          </div>
          {prompt.sourceChat && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50 min-w-0">
              <MessageSquare className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate max-w-[160px]">{prompt.sourceChat}</span>
            </div>
          )}
          {prompt.originalCreatorName && (
            <div className="flex items-center gap-1 text-[10px] text-emerald/70 min-w-0">
              <User className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate max-w-[160px]">
                Original by <span className="font-semibold">{prompt.originalCreatorName}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Share link modal */}
      <SharePromptLinkModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        prompt={{ id: prompt.id, title: prompt.title }}
      />

      {/* Edit modal */}
      <EditPromptModal
        open={editOpen}
        onOpenChange={setEditOpen}
        prompt={{ id: prompt.id, title: prompt.title, collectionId: prompt.collectionId }}
        collections={collections}
        onSave={onEdit}
      />

      {/* Delete confirmation modal */}
      <DeleteConfirmModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        promptTitle={prompt.title}
        onConfirm={() => onDelete(prompt.id)}
      />
    </>
  );
};

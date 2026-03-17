import { useState, useRef, useEffect } from "react";
import { Copy, Check, Bookmark, BookmarkCheck, User, Sparkles, Pencil, RotateCcw, FileText, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FeedbackWidget } from "./FeedbackWidget";
import type { AttachedFile } from "@/types/electron";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  feedback?: {
    rating: "positive" | "negative";
  };
  attachedFiles?: AttachedFile[];
  selectedSkill?: string | null;
}

interface MessageBubbleProps {
  message: Message;
  onCopy: () => void;
  onSave: () => void;
  isSaved: boolean;
  onFeedback?: (messageId: string, rating: "positive" | "negative") => void;
  onEdit?: (messageId: string, currentContent: string) => void;
  onRetry?: (messageId: string) => void;
  isGenerating?: boolean;
}

export const MessageBubble = ({
  message, onCopy, onSave, isSaved, onFeedback, onEdit, onRetry, isGenerating,
}: MessageBubbleProps) => {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === "user";

  // Auto-expand edit textarea whenever editValue changes
  useEffect(() => {
    const ta = editTextareaRef.current;
    if (!ta || !isEditing) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [editValue, isEditing]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEditSubmit = () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false);
      setEditValue(message.content);
      return;
    }
    onEdit?.(message.id, trimmed);
    setIsEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSubmit(); }
    if (e.key === "Escape") { setIsEditing(false); setEditValue(message.content); }
  };

  if (isUser) {
    return (
      <div className="flex justify-end gap-3 animate-slide-up group/user">
        <div className="max-w-[80%]">
          {isEditing ? (
            /* ── Edit mode ── */
            <div className="flex flex-col gap-2">
              <textarea
                ref={editTextareaRef}
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={1}
                className={cn(
                  "w-full rounded-2xl rounded-br-sm px-4 py-3",
                  "bg-emerald/10 border border-emerald/30",
                  "text-sm text-foreground leading-relaxed resize-none outline-none overflow-hidden",
                  "focus:border-emerald/50 focus:shadow-[0_0_0_2px_hsl(var(--emerald)/0.1)]",
                )}
                style={{ minWidth: "280px" }}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => { setIsEditing(false); setEditValue(message.content); }}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSubmit}
                  disabled={!editValue.trim() || editValue.trim() === message.content}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                    editValue.trim() && editValue.trim() !== message.content
                      ? "bg-foreground text-background hover:bg-foreground/90"
                      : "bg-muted text-muted-foreground/40 cursor-not-allowed"
                  )}
                >
                  Send
                </button>
              </div>
            </div>
          ) : (
            /* ── Display mode ── */
            <div className="flex flex-col items-end gap-1.5">
              {/* Attached files — thumbnails for images, pills for PDFs */}
              {message.attachedFiles && message.attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 max-w-md justify-end">
                  {message.attachedFiles.map((file, idx) => {
                    const isImage = file.mimeType.startsWith('image/');
                    const hasBase64 = !!(file as any).base64;

                    if (isImage && hasBase64) {
                      // Real thumbnail from base64
                      return (
                        <div
                          key={idx}
                          className="relative group rounded-xl overflow-hidden border border-emerald/20 shadow-sm"
                          style={{ width: 80, height: 80 }}
                        >
                          <img
                            src={`data:${file.mimeType};base64,${(file as any).base64}`}
                            alt={file.name}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-xl" />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[9px] text-white truncate block">{file.name}</span>
                          </div>
                        </div>
                      );
                    }

                    if (isImage) {
                      // From DB history — no base64, show icon pill
                      return (
                        <div
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald/8 border border-emerald/20 text-xs"
                        >
                          <Image className="h-3.5 w-3.5 text-emerald flex-shrink-0" />
                          <span className="max-w-[100px] truncate text-emerald/90 font-medium">{file.name}</span>
                        </div>
                      );
                    }

                    // PDF pill
                    return (
                      <div
                        key={idx}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald/8 border border-emerald/20 text-xs max-w-[200px]"
                      >
                        <FileText className="h-4 w-4 text-emerald flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="truncate text-emerald font-medium">{file.name}</div>
                          <div className="text-emerald/50 text-[10px]">
                            {(file.sizeBytes / 1024).toFixed(0)} KB • PDF
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              
              {/* Selected skill pill */}
              {message.selectedSkill && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald/10 border border-emerald/20 text-xs">
                  <Sparkles className="h-3 w-3 text-emerald" />
                  <span className="text-emerald font-medium capitalize">{message.selectedSkill}</span>
                </div>
              )}
              
              <div className="bg-emerald/10 border border-emerald/20 rounded-2xl rounded-br-sm px-4 py-3">
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{message.content}</p>
              </div>
              {/* Action row — visible on hover, hidden while generating */}
              {!isGenerating && (onEdit || onRetry) && (
                <div className="flex items-center gap-1 opacity-0 group-hover/user:opacity-100 transition-opacity duration-150">
                  {onEdit && (
                    <button
                      onClick={() => { setIsEditing(true); setEditValue(message.content); }}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
                      title="Edit message"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </button>
                  )}
                  {onRetry && (
                    <button
                      onClick={() => onRetry(message.id)}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
                      title="Retry with this message"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="w-7 h-7 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0 mt-0.5">
          <User className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      </div>
    );
  }

  /* ── Assistant message ─────────────────────────────────── */
  return (
    <div className="flex gap-3 animate-slide-up">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-lg bg-emerald/15 border border-emerald/25 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Sparkles className="w-3.5 h-3.5 text-emerald" />
      </div>

      {/* Bubble */}
      <div className="flex-1 min-w-0 max-w-[96%]">
        <div className="bg-surface border border-border rounded-2xl rounded-tl-sm">
          {/* Content */}
          <div className="px-4 py-3.5">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-0.5 px-3 py-2 border-t border-border/60 bg-surface-elevated/50">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2.5 text-xs rounded-md font-medium transition-smooth gap-1.5",
                copied
                  ? "text-emerald bg-emerald/8 hover:bg-emerald/12"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              onClick={handleCopy}
              data-testid="copy-prompt-button"
            >
              {copied ? (
                <><Check className="w-3 h-3" />Copied</>
              ) : (
                <><Copy className="w-3 h-3" />Copy</>
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2.5 text-xs rounded-md font-medium transition-smooth gap-1.5",
                isSaved
                  ? "text-emerald bg-emerald/8 hover:bg-emerald/12"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              onClick={onSave}
              data-testid="save-prompt-button"
            >
              {isSaved ? (
                <><BookmarkCheck className="w-3 h-3" />Saved</>
              ) : (
                <><Bookmark className="w-3 h-3" />Save</>
              )}
            </Button>

          </div>
        </div>

        {/* Feedback widget */}
        {onFeedback && (
          <div className="mt-2">
            <FeedbackWidget messageId={message.id} onFeedback={onFeedback} initialRating={message.feedback?.rating} />
          </div>
        )}
      </div>
    </div>
  );
};

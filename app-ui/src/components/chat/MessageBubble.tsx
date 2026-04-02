import { useState, useRef, useEffect } from "react";
import { Copy, Check, BookmarkSimple, User, Sparkle, PencilSimple, ArrowCounterClockwise, FileText, ImageSquare, MagnifyingGlassPlus, Paperclip, CaretLeft, CaretRight, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";
import { SKILL_ICON_MAP } from "@/lib/skillIcons";
import { FeedbackWidget } from "./FeedbackWidget";
import { FilePreviewModal, type PreviewFile } from "./FilePreviewModal";
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
  /** Shared by all versions of the same logical message. */
  groupId?: string;
  /** 0-based index within the group (0 = original, 1 = first edit, …). */
  versionIndex?: number;
  /** True when the LLM failed and this is a sentinel error message, not real content. */
  isError?: boolean;
  /** Human-readable error description stored alongside isError. */
  errorMessage?: string;
}

interface MessageBubbleProps {
  message: Message;
  onCopy: () => void;
  onSave: () => void;
  isSaved: boolean;
  onFeedback?: (messageId: string, rating: "positive" | "negative") => void;
  onEdit?: (messageId: string, currentContent: string) => void;
  onRegenerate?: (messageId: string) => void;
  isGenerating?: boolean;
  /** Number of files that were included in context for this response (assistant only) */
  fileContextCount?: number;
  /** User's profile avatar URL (shown on user messages) */
  avatarUrl?: string | null;
  /** Version info for user messages — shown inline with the edit button */
  versionInfo?: { current: number; total: number; parentId: string };
  onNavigateVersion?: (parentId: string, direction: 'prev' | 'next') => void;
}

export const MessageBubble = ({
  message, onCopy, onSave, isSaved, onFeedback, onEdit, onRegenerate, isGenerating, fileContextCount, avatarUrl,
  versionInfo, onNavigateVersion,
}: MessageBubbleProps) => {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === "user";

  // Auto-expand edit textarea whenever editValue changes
  useEffect(() => {
    const ta = editTextareaRef.current;
    if (!ta || !isEditing) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [editValue, isEditing]);

  // Move cursor to end of text when edit mode opens
  useEffect(() => {
    if (!isEditing) return;
    const ta = editTextareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  }, [isEditing]);

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
      <>
      <div className="flex justify-end gap-3 animate-slide-up group/user">
        <div className="max-w-[80%]">
          {isEditing ? (
            /* ── Edit mode ── */
            <div className="flex flex-col gap-2">
              <textarea
                ref={editTextareaRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={1}
                className={cn(
                  "w-full rounded-2xl rounded-br-sm px-4 py-3",
                  "bg-emerald/10 border border-emerald/30",
                  "text-sm text-foreground leading-relaxed resize-none outline-none overflow-hidden",
                  "focus:border-emerald/50 focus:shadow-[0_0_0_2px_hsl(var(--accent)/0.1)]",
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
              {/* Attached files — thumbnails for images, PDF cards — all clickable */}
              {message.attachedFiles && message.attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 max-w-md justify-end">
                  {message.attachedFiles.map((file, idx) => {
                    const isImage = file.mimeType.startsWith('image/');
                    const hasBase64 = !!(file as any).base64;
                    const cloudinaryUrl: string | undefined = (file as any).cloudinaryUrl;
                    const storagePath: string | undefined = (file as any).storagePath;

                    // Image: prefer Cloudinary URL, fall back to base64
                    if (isImage && (cloudinaryUrl || hasBase64)) {
                      const src = cloudinaryUrl ?? `data:${file.mimeType};base64,${(file as any).base64}`;
                      const previewEntry: PreviewFile = cloudinaryUrl
                        ? { name: file.name, mimeType: file.mimeType, cloudinaryUrl, sizeBytes: file.sizeBytes }
                        : { name: file.name, mimeType: file.mimeType, base64: (file as any).base64 as string, sizeBytes: file.sizeBytes };
                      return (
                        <button
                          key={idx}
                          onClick={() => setPreviewFile(previewEntry)}
                          className="relative group rounded-xl overflow-hidden border border-white/10 shadow cursor-zoom-in focus:outline-none"
                          style={{ width: 80, height: 80 }}
                          title={`${file.name} — click to preview`}
                        >
                          <img src={src} alt={file.name} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                            <MagnifyingGlassPlus size={20} weight="light" className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                          </div>
                        </button>
                      );
                    }

                    if (isImage) {
                      return (
                        <div key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald/8 border border-emerald/20 text-xs">
                          <ImageSquare size={14} weight="light" className="text-emerald flex-shrink-0" />
                          <span className="max-w-[100px] truncate text-emerald/90 font-medium">{file.name}</span>
                        </div>
                      );
                    }

                    // PDF: prefer in-session base64 preview
                    if (hasBase64) {
                      return (
                        <button
                          key={idx}
                          onClick={() => setPreviewFile({ name: file.name, mimeType: file.mimeType, base64: (file as any).base64, sizeBytes: file.sizeBytes })}
                          className="flex items-center gap-2.5 h-14 px-3 rounded-xl bg-secondary border border-border hover:border-border/60 hover:bg-secondary/80 transition-colors max-w-[220px] focus:outline-none group"
                          title={`${file.name} — click to preview`}
                        >
                          <div className="w-8 h-8 rounded-lg bg-red-500/12 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                            <FileText size={16} weight="light" className="text-red-400" />
                          </div>
                          <div className="min-w-0 text-left">
                            <p className="text-xs font-medium text-foreground truncate max-w-[140px] group-hover:underline">{file.name}</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                              {file.sizeBytes ? `${(file.sizeBytes / 1024).toFixed(0)} KB · ` : ""}PDF
                            </p>
                          </div>
                        </button>
                      );
                    }

                    // PDF from DB with storagePath: open via signed URL in system viewer
                    if (storagePath) {
                      return (
                        <button
                          key={idx}
                          onClick={async () => {
                            if (window.electronAPI?.storage?.openPdf) {
                              await window.electronAPI.storage.openPdf(storagePath);
                            }
                          }}
                          className="flex items-center gap-2.5 h-14 px-3 rounded-xl bg-secondary border border-border hover:border-border/60 hover:bg-secondary/80 transition-colors max-w-[220px] focus:outline-none group"
                          title={`${file.name} — click to open`}
                        >
                          <div className="w-8 h-8 rounded-lg bg-red-500/12 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                            <FileText size={16} weight="light" className="text-red-400" />
                          </div>
                          <div className="min-w-0 text-left">
                            <p className="text-xs font-medium text-foreground truncate max-w-[140px] group-hover:underline">{file.name}</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                              {file.sizeBytes ? `${(file.sizeBytes / 1024).toFixed(0)} KB · ` : ""}PDF
                            </p>
                          </div>
                        </button>
                      );
                    }

                    // PDF — no refs available, static chip
                    return (
                      <div key={idx} className="flex items-center gap-2.5 h-14 px-3 rounded-xl bg-secondary border border-border max-w-[220px]">
                        <div className="w-8 h-8 rounded-lg bg-red-500/12 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                          <FileText size={16} weight="light" className="text-red-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate max-w-[140px]">{file.name}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                            {file.sizeBytes ? `${(file.sizeBytes / 1024).toFixed(0)} KB · ` : ""}PDF
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              
              {/* Selected skill pill — same icon as composer / skill picker */}
              {message.selectedSkill && (() => {
                const SkillIcon = SKILL_ICON_MAP[message.selectedSkill] ?? Sparkle;
                return (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald/10 border border-emerald/20 text-xs">
                    <SkillIcon size={12} weight="light" className="text-emerald" />
                    <span className="text-emerald font-medium capitalize">{message.selectedSkill}</span>
                  </div>
                );
              })()}
              
              <div className="bg-emerald/10 border border-emerald/20 rounded-2xl rounded-br-sm px-4 py-3">
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{message.content}</p>
              </div>
              {/* Action row — always visible, contains edit button + version navigator */}
              {!isGenerating && (onEdit || (versionInfo && versionInfo.total > 1)) && (
                <div className="flex items-center gap-2 justify-end">
                  {/* Version navigator — shown inline when multiple versions exist */}
                  {versionInfo && versionInfo.total > 1 && onNavigateVersion && (
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => onNavigateVersion(versionInfo.parentId, 'prev')}
                        disabled={versionInfo.current <= 1}
                        className={cn(
                          "w-5 h-5 rounded flex items-center justify-center transition-colors",
                          versionInfo.current <= 1
                            ? "text-muted-foreground/25 cursor-not-allowed"
                            : "text-muted-foreground/60 hover:text-foreground hover:bg-secondary"
                        )}
                        aria-label="Previous version"
                      >
                        <CaretLeft size={12} weight="light" />
                      </button>
                      <span className="text-[10px] text-muted-foreground/50 font-medium tabular-nums min-w-[2rem] text-center select-none">
                        {versionInfo.current}/{versionInfo.total}
                      </span>
                      <button
                        onClick={() => onNavigateVersion(versionInfo.parentId, 'next')}
                        disabled={versionInfo.current >= versionInfo.total}
                        className={cn(
                          "w-5 h-5 rounded flex items-center justify-center transition-colors",
                          versionInfo.current >= versionInfo.total
                            ? "text-muted-foreground/25 cursor-not-allowed"
                            : "text-muted-foreground/60 hover:text-foreground hover:bg-secondary"
                        )}
                        aria-label="Next version"
                      >
                        <CaretRight size={12} weight="light" />
                      </button>
                    </div>
                  )}
                  {/* Edit button — always visible */}
                  {onEdit && (
                    <button
                      onClick={() => { setIsEditing(true); setEditValue(message.content); }}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
                      title="Edit message"
                    >
                      <PencilSimple size={12} weight="light" />
                      Edit
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0 mt-0.5 border border-border" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0 mt-0.5">
            <User size={14} weight="light" className="text-muted-foreground" />
          </div>
        )}
      </div>

      {/* File preview modal */}
      <FilePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
        allFiles={
          (message.attachedFiles ?? [])
            .filter(f => f.mimeType.startsWith('image/') && (!!(f as any).base64 || !!(f as any).cloudinaryUrl))
            .map(f => ({
              name: f.name,
              mimeType: f.mimeType,
              base64: (f as any).base64 as string | undefined,
              cloudinaryUrl: (f as any).cloudinaryUrl as string | undefined,
              sizeBytes: f.sizeBytes,
            }))
        }
      />
    </>
  );
  }

  /* ── Assistant message ─────────────────────────────────── */
  return (
    <div className="flex gap-3 animate-slide-up">
      {/* Avatar — theme-aware app logo (light UI → dark mark, dark UI → light mark) */}
      <div className="w-7 h-7 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Logo size="w-7 h-7" />
      </div>

      {/* Bubble */}
      <div className="flex-1 min-w-0 max-w-[96%]">
        <div className="bg-surface border border-border rounded-2xl rounded-tl-sm">
          {/* File context indicator — shown when files were included */}
          {fileContextCount != null && fileContextCount > 0 && (
            <div className="flex items-center gap-1.5 px-4 pt-3 pb-0">
              <Paperclip size={12} weight="light" className="text-emerald/70 flex-shrink-0" />
              <span className="text-[11px] text-emerald/70 font-medium">
                {fileContextCount === 1 ? "Using attached file" : `Using ${fileContextCount} attached files`}
              </span>
            </div>
          )}
          {/* Content — error state or normal text */}
          {message.isError ? (
            <div className="flex items-start gap-2.5 px-4 py-3.5">
              <WarningCircle size={16} weight="light" className="text-destructive flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-destructive">Response failed</p>
                {message.errorMessage && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{message.errorMessage}</p>
                )}
              </div>
            </div>
          ) : (
          <div className="px-4 py-3.5">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </div>
          )}

          {/* Action bar — hidden for error sentinels (nothing to copy/save) */}
          {!message.isError && (
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
                <><Check size={12} weight="light" />Copied</>
              ) : (
                <><Copy size={12} weight="light" />Copy</>
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
                <><BookmarkSimple size={12} weight="fill" />Saved</>
              ) : (
                <><BookmarkSimple size={12} weight="light" />Save</>
              )}
            </Button>

            {onRegenerate && !isGenerating && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs rounded-md font-medium transition-smooth gap-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary"
                onClick={() => onRegenerate(message.id)}
              >
                <ArrowCounterClockwise size={12} weight="light" />
                Regenerate
              </Button>
            )}

          </div>
          )}
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

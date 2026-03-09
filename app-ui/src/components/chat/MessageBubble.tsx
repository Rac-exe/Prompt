import { useState } from "react";
import { Copy, Check, Bookmark, BookmarkCheck, User, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FeedbackWidget } from "./FeedbackWidget";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface MessageBubbleProps {
  message: Message;
  onCopy: () => void;
  onSave: () => void;
  isSaved: boolean;
  onFeedback?: (messageId: string, rating: "positive" | "negative") => void;
}

export const MessageBubble = ({ message, onCopy, onSave, isSaved, onFeedback }: MessageBubbleProps) => {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 2000);
  };

  if (isUser) {
    return (
      <div className="flex justify-end gap-3 animate-slide-up">
        <div className="max-w-[72%] group">
          <div className="bg-emerald/10 border border-emerald/20 rounded-2xl rounded-br-sm px-4 py-3">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </div>
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
      <div className="flex-1 min-w-0 max-w-[88%]">
        <div className="bg-surface border border-border rounded-2xl rounded-tl-sm overflow-hidden">
          {/* Content */}
          <div className={cn(
            "px-4 py-3.5 overflow-y-auto",
            message.content.length > 1200 && "max-h-[480px]"
          )}>
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
            <FeedbackWidget messageId={message.id} onFeedback={onFeedback} />
          </div>
        )}
      </div>
    </div>
  );
};

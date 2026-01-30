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

  return (
    <div
      className={cn(
        "flex gap-3 animate-slide-up",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-lg bg-emerald flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3",
          isUser
            ? "bg-secondary text-foreground"
            : "bg-surface border border-border",
          !isUser && "max-h-[500px] overflow-y-auto"
        )}
      >
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>

        {!isUser && (
          <div className="flex items-center gap-1 mt-3 pt-2 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2 text-xs transition-button",
                copied
                  ? "text-emerald hover:text-emerald"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={handleCopy}
              data-testid="copy-prompt-button"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 mr-1" />
                  Copied ✓
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2 text-xs transition-button",
                isSaved
                  ? "text-emerald hover:text-emerald"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={onSave}
              data-testid="save-prompt-button"
            >
              {isSaved ? (
                <>
                  <BookmarkCheck className="w-3 h-3 mr-1" />
                  Saved
                </>
              ) : (
                <>
                  <Bookmark className="w-3 h-3 mr-1" />
                  Save
                </>
              )}
            </Button>
          </div>
        )}

        {!isUser && onFeedback && (
          <FeedbackWidget messageId={message.id} onFeedback={onFeedback} />
        )}
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-foreground" />
        </div>
      )}
    </div>
  );
};

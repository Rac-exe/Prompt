import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface FeedbackWidgetProps {
  messageId: string;
  onFeedback?: (messageId: string, rating: "positive" | "negative") => void;
  onDismiss?: (messageId: string) => void;
}

export const FeedbackWidget = ({ messageId, onFeedback, onDismiss }: FeedbackWidgetProps) => {
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleRate = (type: "positive" | "negative") => {
    setRating(type);
    onFeedback?.(messageId, type);
    setTimeout(() => setDismissed(true), 900);
  };

  return (
    <div className="flex items-center gap-2 animate-fade-in">
      <span className="text-[11px] text-muted-foreground/50">Was this helpful?</span>
      <div className="flex gap-1">
        <button
          onClick={() => handleRate("positive")}
          disabled={rating !== null}
          className={cn(
            "inline-flex items-center justify-center w-6 h-6 rounded-md transition-smooth text-muted-foreground disabled:cursor-default",
            rating === "positive"
              ? "bg-emerald/15 text-emerald"
              : "hover:bg-secondary hover:text-foreground"
          )}
        >
          <ThumbsUp className="w-3 h-3" />
        </button>
        <button
          onClick={() => handleRate("negative")}
          disabled={rating !== null}
          className={cn(
            "inline-flex items-center justify-center w-6 h-6 rounded-md transition-smooth text-muted-foreground disabled:cursor-default",
            rating === "negative"
              ? "bg-destructive/12 text-destructive"
              : "hover:bg-secondary hover:text-foreground"
          )}
        >
          <ThumbsDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

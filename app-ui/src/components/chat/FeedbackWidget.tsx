import { useState } from "react";
import { ThumbsUp, ThumbsDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FeedbackWidgetProps {
  messageId: string;
  onFeedback?: (messageId: string, rating: "positive" | "negative") => void;
  onDismiss?: (messageId: string) => void;
}

export const FeedbackWidget = ({
  messageId,
  onFeedback,
  onDismiss,
}: FeedbackWidgetProps) => {
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleRate = (type: "positive" | "negative") => {
    setRating(type);
    onFeedback?.(messageId, type);
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.(messageId);
  };

  return (
    <div className="flex items-center gap-2 mt-3 p-2 bg-surface/50 border border-border rounded-lg animate-slide-up">
      <span className="text-xs text-muted-foreground">Was this helpful?</span>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-2 hover:bg-emerald/10 hover:text-emerald transition-button",
            rating === "positive" && "bg-emerald/20 text-emerald"
          )}
          onClick={() => handleRate("positive")}
          disabled={rating !== null}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-2 hover:bg-destructive/10 hover:text-destructive transition-button",
            rating === "negative" && "bg-destructive/20 text-destructive"
          )}
          onClick={() => handleRate("negative")}
          disabled={rating !== null}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </Button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 ml-auto text-muted-foreground hover:text-foreground"
        onClick={handleDismiss}
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
};

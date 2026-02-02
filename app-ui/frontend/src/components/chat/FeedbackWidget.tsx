import { useState } from "react";
import { ThumbsUp, ThumbsDown, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface FeedbackWidgetProps {
  messageId: string;
  onDismiss: () => void;
}

export const FeedbackWidget = ({ messageId, onDismiss }: FeedbackWidgetProps) => {
  const [rating, setRating] = useState<"up" | "down" | null>(null);

  const handleRating = (type: "up" | "down") => {
    setRating(type);
    toast({
      title: "Thanks for your feedback!",
      description: type === "up" ? "Glad you found this helpful" : "We'll work to improve",
    });
    
    // Auto-dismiss after rating
    setTimeout(() => {
      onDismiss();
    }, 1500);
  };

  return (
    <div className="flex items-center gap-2 p-3 bg-surface/80 backdrop-blur-sm border border-border rounded-lg animate-slide-up">
      <span className="text-xs text-muted-foreground flex-shrink-0">How was this response?</span>
      
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleRating("up")}
          disabled={rating !== null}
          className={cn(
            "h-7 px-2 transition-button",
            rating === "up" && "text-emerald bg-emerald/10"
          )}
          data-testid="feedback-thumbs-up"
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleRating("down")}
          disabled={rating !== null}
          className={cn(
            "h-7 px-2 transition-button",
            rating === "down" && "text-destructive bg-destructive/10"
          )}
          data-testid="feedback-thumbs-down"
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </Button>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        className="h-6 w-6 ml-auto text-muted-foreground hover:text-foreground"
        data-testid="feedback-dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
};

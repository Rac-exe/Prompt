import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "@phosphor-icons/react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface FeedbackModalProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (rating: "positive" | "negative", comment?: string) => void;
    promptPreview?: string;
}

export const FeedbackModal = ({
    open,
    onClose,
    onSubmit,
    promptPreview,
}: FeedbackModalProps) => {
    const [rating, setRating] = useState<"positive" | "negative" | null>(null);
    const [comment, setComment] = useState("");
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = () => {
        if (rating) {
            onSubmit(rating, comment || undefined);
            setSubmitted(true);
            setTimeout(() => {
                handleClose();
            }, 1500);
        }
    };

    const handleClose = () => {
        setRating(null);
        setComment("");
        setSubmitted(false);
        onClose();
    };

    const handleRatingClick = (selectedRating: "positive" | "negative") => {
        setRating(selectedRating);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    handleClose();
                }
            }}
        >
            <DialogContent className="sm:max-w-md bg-card border-border">
                <DialogHeader>
                    <DialogTitle className="text-foreground">
                        {submitted ? "Thank you!" : "Rate this prompt"}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        {submitted
                            ? "Your feedback helps us improve!"
                            : "How would you rate the optimized prompt?"}
                    </DialogDescription>
                </DialogHeader>

                {!submitted ? (
                    <div className="space-y-4">
                        {/* Prompt Preview */}
                        {promptPreview && (
                            <div className="bg-secondary/50 rounded-lg p-3 max-h-20 overflow-hidden">
                                <p className="text-xs text-muted-foreground line-clamp-3">
                                    {promptPreview}
                                </p>
                            </div>
                        )}

                        {/* Rating Buttons */}
                        <div className="flex gap-3 justify-center">
                            <Button
                                variant={rating === "positive" ? "default" : "outline"}
                                size="lg"
                                onClick={() => handleRatingClick("positive")}
                                className={`flex-1 gap-2 transition-all ${rating === "positive"
                                        ? "bg-emerald/10 text-emerald border border-emerald/30 hover:bg-emerald/15"
                                        : "border-border hover:bg-secondary"
                                    }`}
                            >
                                <ThumbsUp size={20} weight="light" />
                                Good
                            </Button>
                            <Button
                                variant={rating === "negative" ? "default" : "outline"}
                                size="lg"
                                onClick={() => handleRatingClick("negative")}
                                className={`flex-1 gap-2 transition-all ${rating === "negative"
                                        ? "bg-destructive text-white hover:bg-destructive/90"
                                        : "border-border hover:bg-secondary"
                                    }`}
                            >
                                <ThumbsDown size={20} weight="light" />
                                Not Good
                            </Button>
                        </div>

                        {/* Optional Comment */}
                        {rating && (
                            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                <label className="text-sm text-muted-foreground">
                                    Additional feedback (optional)
                                </label>
                                <Textarea
                                    placeholder="What could be improved?"
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    className="min-h-[80px] bg-secondary border-border resize-none text-sm"
                                />
                            </div>
                        )}

                        {/* Submit Button */}
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={handleClose}
                                className="flex-1 border-border"
                            >
                                Skip
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={!rating}
                                className="flex-1 border border-input text-foreground hover:bg-muted font-semibold disabled:opacity-50"
                            >
                                Submit
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="py-8 text-center animate-in zoom-in duration-300">
                        <div className="w-16 h-16 bg-emerald/20 rounded-full flex items-center justify-center mx-auto mb-3">
                            <ThumbsUp size={32} weight="light" className="text-emerald" />
                        </div>
                        <p className="text-foreground font-medium">Feedback received!</p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

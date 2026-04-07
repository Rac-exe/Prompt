import { useState, useCallback } from "react";
import { PaperPlaneRight, ArrowRight, ListChecks } from "@phosphor-icons/react";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

export interface ClarifyQuestion {
  id: string;
  question: string;
  type: "multiple_choice" | "text";
  options: string[];
  allow_other: boolean;
  optional: boolean;
}

interface ClarificationCardProps {
  questions: ClarifyQuestion[];
  isComplex: boolean;
  suggestedSections: string[];
  onSubmit: (answers: Record<string, string>, wantsSections: boolean) => void;
  onSkip: () => void;
}

export const ClarificationCard = ({
  questions,
  isComplex,
  suggestedSections,
  onSubmit,
  onSkip,
}: ClarificationCardProps) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});

  const setAnswer = useCallback((id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const setOtherText = useCallback((id: string, value: string) => {
    setOtherTexts((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    const finalAnswers: Record<string, string> = {};
    for (const q of questions) {
      const answer = answers[q.id];
      if (!answer) continue;
      if (answer === "__other__") {
        finalAnswers[q.question] = otherTexts[q.id] || "";
      } else {
        finalAnswers[q.question] = answer;
      }
    }

    const deliveryQ = questions.find(
      (q) =>
        q.id === "delivery_format" ||
        q.question.toLowerCase().includes("task sections") ||
        q.question.toLowerCase().includes("broken into")
    );
    const wantsSections =
      deliveryQ &&
      answers[deliveryQ.id] &&
      (answers[deliveryQ.id].toLowerCase().includes("section") ||
        answers[deliveryQ.id].toLowerCase().includes("broken"));

    onSubmit(finalAnswers, !!wantsSections);
  }, [questions, answers, otherTexts, onSubmit]);

  return (
    <div className="flex gap-3 px-4 py-3 max-w-4xl mx-auto w-full">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Logo className="w-3.5 h-3.5" />
      </div>

      <div className="flex-1 min-w-0 space-y-4">
        <p className="text-sm text-muted-foreground">
          A few quick questions to make this prompt even better:
        </p>

        {questions.map((q) => (
          <div key={q.id} className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              {q.question}
              {q.optional && (
                <span className="text-muted-foreground/50 font-normal ml-1.5">
                  (optional)
                </span>
              )}
            </p>

            {q.type === "multiple_choice" ? (
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAnswer(q.id, opt)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                      answers[q.id] === opt
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary/50 text-muted-foreground border-border hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    {opt}
                  </button>
                ))}
                {q.allow_other && (
                  <button
                    type="button"
                    onClick={() => setAnswer(q.id, "__other__")}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                      answers[q.id] === "__other__"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary/50 text-muted-foreground border-border hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    Other
                  </button>
                )}
                {answers[q.id] === "__other__" && (
                  <input
                    type="text"
                    placeholder="Describe..."
                    value={otherTexts[q.id] || ""}
                    onChange={(e) => setOtherText(q.id, e.target.value)}
                    className="w-full mt-1 px-3 py-2 text-xs rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground placeholder:text-muted-foreground/40"
                    autoFocus
                  />
                )}
              </div>
            ) : (
              <textarea
                placeholder="Type your answer..."
                value={answers[q.id] || ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-xs rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground placeholder:text-muted-foreground/40 resize-none"
              />
            )}
          </div>
        ))}

        {isComplex && suggestedSections.length > 0 && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-secondary/30 border border-border/50">
            <ListChecks
              size={14}
              weight="duotone"
              className="text-emerald mt-0.5 flex-shrink-0"
            />
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Suggested sections:
              </span>{" "}
              {suggestedSections.join(" → ")}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <PaperPlaneRight size={12} weight="bold" />
            Submit & optimize
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Skip & optimize directly
            <ArrowRight size={10} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
};

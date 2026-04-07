import { useState, useCallback, useEffect, useRef } from "react";
import {
  Sparkle,
  PaperPlaneRight,
  ArrowRight,
  CheckSquare,
  Square,
  PencilSimpleLine,
  ListChecks,
  Lightning,
} from "@phosphor-icons/react";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

export interface ClarifyQuestion {
  id: string;
  question: string;
  type: "multiple_choice" | "text";
  options: string[];
  optional: boolean;
}

interface ClarificationCardProps {
  questions: ClarifyQuestion[];
  isComplex: boolean;
  suggestedSections: string[];
  onSubmit: (answers: Record<string, string>, wantsSections: boolean) => void;
  onSkip: () => void;
  compact?: boolean;
}

export const ClarificationCard = ({
  questions,
  isComplex,
  suggestedSections,
  onSubmit,
  onSkip,
  compact = false,
}: ClarificationCardProps) => {
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [otherActive, setOtherActive] = useState<Record<string, boolean>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [extraNotes, setExtraNotes] = useState("");
  const [visibleCount, setVisibleCount] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visibleCount >= questions.length + 1) return;
    const timer = setTimeout(
      () => setVisibleCount((c) => c + 1),
      visibleCount === 0 ? 150 : 120
    );
    return () => clearTimeout(timer);
  }, [visibleCount, questions.length]);

  const toggleOption = useCallback((qId: string, option: string) => {
    setSelections((prev) => {
      const current = new Set(prev[qId] || []);
      if (current.has(option)) {
        current.delete(option);
      } else {
        current.add(option);
      }
      return { ...prev, [qId]: current };
    });
  }, []);

  const toggleOther = useCallback((qId: string) => {
    setOtherActive((prev) => ({ ...prev, [qId]: !prev[qId] }));
  }, []);

  const answeredCount = questions.filter((q) => {
    if (q.type === "multiple_choice") {
      return (selections[q.id]?.size ?? 0) > 0 || otherActive[q.id];
    }
    return !!textAnswers[q.id];
  }).length;

  const handleSubmit = useCallback(() => {
    setSubmitted(true);
    const finalAnswers: Record<string, string> = {};

    for (const q of questions) {
      if (q.type === "multiple_choice") {
        const parts: string[] = [];
        const sel = selections[q.id];
        if (sel?.size) parts.push(...Array.from(sel));
        if (otherActive[q.id] && otherTexts[q.id]?.trim()) {
          parts.push(otherTexts[q.id].trim());
        }
        if (parts.length > 0) finalAnswers[q.question] = parts.join(", ");
      } else {
        const val = textAnswers[q.id];
        if (val?.trim()) finalAnswers[q.question] = val.trim();
      }
    }

    if (extraNotes.trim()) {
      finalAnswers["Additional context"] = extraNotes.trim();
    }

    const deliveryQ = questions.find(
      (q) =>
        q.id === "delivery_format" ||
        q.question.toLowerCase().includes("task sections") ||
        q.question.toLowerCase().includes("broken into") ||
        q.question.toLowerCase().includes("delivery") ||
        q.question.toLowerCase().includes("one complete")
    );
    let wantsSections = false;
    if (deliveryQ) {
      const sel = selections[deliveryQ.id];
      if (sel) {
        for (const v of sel) {
          const lv = v.toLowerCase();
          if (lv.includes("section") || lv.includes("broken") || lv.includes("task")) {
            wantsSections = true;
            break;
          }
        }
      }
    }

    onSubmit(finalAnswers, wantsSections);
  }, [questions, selections, otherActive, otherTexts, textAnswers, extraNotes, onSubmit]);

  if (submitted) return null;

  return (
    <div className={cn(
      compact ? "px-2 py-2 w-full" : "flex gap-3 px-4 py-3 max-w-4xl mx-auto w-full"
    )}>
      {!compact && (
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
          <Logo className="w-3.5 h-3.5" />
        </div>
      )}

      <div ref={cardRef} className="flex-1 min-w-0">
        <div className={cn(
          "rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden",
          compact && "rounded-xl"
        )}>
          {/* ── Header ── */}
          <div className={compact ? "px-3.5 pt-3 pb-2" : "px-5 pt-4 pb-3"}>
            <div className="flex items-center gap-2">
              <Sparkle
                size={compact ? 13 : 15}
                weight="fill"
                className="text-amber-500 animate-[spin_3s_linear_infinite]"
              />
              <h3 className={cn(
                "font-semibold text-foreground tracking-tight",
                compact ? "text-[12px]" : "text-[13px]"
              )}>
                Let's dial this in
              </h3>
            </div>
            <p className={cn(
              "text-muted-foreground/70 mt-0.5",
              compact ? "text-[10px] ml-[21px]" : "text-[11px] ml-[23px]"
            )}>
              Pick all that apply — select multiple if you want
            </p>
          </div>

          {/* ── Progress bar ── */}
          {questions.length > 1 && (
            <div className={cn(
              "flex items-center gap-1.5",
              compact ? "px-3.5 pb-2" : "px-5 pb-3"
            )}>
              {questions.map((q) => {
                const hasAnswer =
                  q.type === "multiple_choice"
                    ? (selections[q.id]?.size ?? 0) > 0 || otherActive[q.id]
                    : !!textAnswers[q.id];
                return (
                  <div
                    key={q.id}
                    className={cn(
                      "h-1 rounded-full transition-all duration-500",
                      hasAnswer ? "bg-primary flex-[2]" : "bg-border/60 flex-1"
                    )}
                  />
                );
              })}
            </div>
          )}

          {/* ── Questions ── */}
          <div className={cn(
            compact ? "px-3.5 pb-1.5 space-y-3.5" : "px-5 pb-2 space-y-5"
          )}>
            {questions.map((q, i) => (
              <div
                key={q.id}
                className={cn(
                  "transition-all duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
                  i < visibleCount
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-3 pointer-events-none"
                )}
              >
                <p className={cn(
                  "font-medium text-foreground leading-snug",
                  compact ? "text-[12px] mb-2" : "text-[13px] mb-2.5"
                )}>
                  {q.question}
                </p>

                {q.type === "multiple_choice" && q.options.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className={cn(
                      "gap-1.5",
                      compact ? "flex flex-col" : "grid grid-cols-2"
                    )}>
                      {q.options.map((opt) => {
                        const selected = selections[q.id]?.has(opt) ?? false;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => toggleOption(q.id, opt)}
                            className={cn(
                              "group flex items-center text-left transition-all duration-200 border",
                              compact
                                ? "gap-2 px-2.5 py-2 rounded-lg"
                                : "gap-2.5 px-3 py-2.5 rounded-xl",
                              selected
                                ? "border-primary/40 bg-primary/[0.06] shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                                : "border-transparent bg-muted/40 hover:bg-muted/70"
                            )}
                          >
                            {selected ? (
                              <CheckSquare
                                size={compact ? 14 : 16}
                                weight="fill"
                                className="text-primary flex-shrink-0 transition-transform duration-200 scale-110"
                              />
                            ) : (
                              <Square
                                size={compact ? 14 : 16}
                                weight="regular"
                                className="text-muted-foreground/30 flex-shrink-0 group-hover:text-muted-foreground/50 transition-colors"
                              />
                            )}
                            <span
                              className={cn(
                                "leading-snug transition-colors",
                                compact ? "text-[11px]" : "text-xs",
                                selected
                                  ? "text-foreground font-medium"
                                  : "text-muted-foreground group-hover:text-foreground"
                              )}
                            >
                              {opt}
                            </span>
                          </button>
                        );
                      })}

                      {/* Other option */}
                      <button
                        type="button"
                        onClick={() => toggleOther(q.id)}
                        className={cn(
                          "group flex items-center text-left transition-all duration-200 border",
                          compact
                            ? "gap-2 px-2.5 py-2 rounded-lg"
                            : "gap-2.5 px-3 py-2.5 rounded-xl",
                          otherActive[q.id]
                            ? "border-primary/40 bg-primary/[0.06] shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                            : "border-transparent bg-muted/40 hover:bg-muted/70"
                        )}
                      >
                        <PencilSimpleLine
                          size={compact ? 14 : 16}
                          weight={otherActive[q.id] ? "fill" : "regular"}
                          className={cn(
                            "flex-shrink-0 transition-colors",
                            otherActive[q.id]
                              ? "text-primary"
                              : "text-muted-foreground/30 group-hover:text-muted-foreground/50"
                          )}
                        />
                        <span
                          className={cn(
                            "leading-snug transition-colors",
                            compact ? "text-[11px]" : "text-xs",
                            otherActive[q.id]
                              ? "text-foreground font-medium"
                              : "text-muted-foreground group-hover:text-foreground"
                          )}
                        >
                          Other
                        </span>
                      </button>
                    </div>

                    {/* Other text input */}
                    {otherActive[q.id] && (
                      <input
                        type="text"
                        placeholder="Describe what you have in mind..."
                        value={otherTexts[q.id] || ""}
                        onChange={(e) =>
                          setOtherTexts((prev) => ({
                            ...prev,
                            [q.id]: e.target.value,
                          }))
                        }
                        autoFocus
                        className={cn(
                          "w-full text-foreground placeholder:text-muted-foreground/40 transition-all bg-muted/30 border border-primary/20 focus:border-primary/40 focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary/15",
                          compact ? "px-2.5 py-2 text-[11px] rounded-lg" : "px-3.5 py-2.5 text-xs rounded-xl"
                        )}
                      />
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder="Type your answer..."
                    value={textAnswers[q.id] || ""}
                    onChange={(e) =>
                      setTextAnswers((prev) => ({
                        ...prev,
                        [q.id]: e.target.value,
                      }))
                    }
                    className={cn(
                      "w-full text-foreground placeholder:text-muted-foreground/40 transition-all bg-muted/40 border border-transparent focus:border-primary/30 focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary/15",
                      compact ? "px-2.5 py-2 text-[11px] rounded-lg" : "px-3.5 py-2.5 text-xs rounded-xl"
                    )}
                  />
                )}
              </div>
            ))}

            {/* ── Suggested sections ── */}
            {isComplex && suggestedSections.length > 0 && (
              <div
                className={cn(
                  "flex items-start gap-2.5 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/10 transition-all duration-[400ms]",
                  compact ? "px-2.5 py-2" : "px-3.5 py-3",
                  visibleCount > 0
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-3"
                )}
              >
                <ListChecks
                  size={compact ? 13 : 15}
                  weight="duotone"
                  className="text-emerald-600 dark:text-emerald-400 mt-px flex-shrink-0"
                />
                <div className={cn(
                  "leading-relaxed text-muted-foreground",
                  compact ? "text-[10px]" : "text-[11px]"
                )}>
                  <span className="font-medium text-foreground">
                    Suggested build flow:{" "}
                  </span>
                  {suggestedSections.map((s, i) => (
                    <span key={i}>
                      <span className="text-foreground/80">{s}</span>
                      {i < suggestedSections.length - 1 && (
                        <span className="mx-1 text-muted-foreground/40">→</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Anything else box ── */}
            <div
              className={cn(
                "transition-all duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
                visibleCount >= questions.length
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-3 pointer-events-none"
              )}
            >
              <textarea
                placeholder="Anything else on your mind? Describe freely..."
                value={extraNotes}
                onChange={(e) => setExtraNotes(e.target.value)}
                rows={compact ? 1 : 2}
                className={cn(
                  "w-full border border-dashed border-border/50 bg-muted/20 focus:border-primary/30 focus:bg-background focus:border-solid focus:outline-none focus:ring-1 focus:ring-primary/15 text-foreground placeholder:text-muted-foreground/35 transition-all resize-none",
                  compact ? "px-2.5 py-2 text-[11px] rounded-lg" : "px-3.5 py-2.5 text-xs rounded-xl"
                )}
              />
            </div>
          </div>

          {/* ── Footer ── */}
          <div
            className={cn(
              "border-t border-border/30 flex items-center justify-between transition-all duration-500",
              compact ? "px-3.5 py-2" : "px-5 py-3",
              visibleCount >= questions.length
                ? "opacity-100"
                : "opacity-0"
            )}
          >
            <button
              type="button"
              onClick={onSkip}
              className={cn(
                "inline-flex items-center gap-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors",
                compact ? "text-[10px]" : "text-[11px]"
              )}
            >
              Skip — just optimize
              <ArrowRight size={compact ? 9 : 10} weight="bold" />
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              className={cn(
                "inline-flex items-center gap-1.5 font-semibold transition-all duration-200",
                compact ? "px-3 py-1.5 rounded-lg text-[11px]" : "px-4 py-2 rounded-xl text-xs",
                answeredCount > 0
                  ? "bg-primary text-primary-foreground shadow-sm hover:shadow-md hover:brightness-110 active:scale-[0.97]"
                  : "bg-primary/80 text-primary-foreground/80"
              )}
            >
              <Lightning size={compact ? 11 : 13} weight="fill" />
              Optimize
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

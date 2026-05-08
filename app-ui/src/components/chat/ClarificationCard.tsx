import { useState, useCallback, useEffect, useRef } from "react";
import * as Sentry from "@sentry/react";
import {
  Sparkle,
  ArrowRight,
  ArrowLeft,
  CaretRight,
  CaretLeft,
  CheckSquare,
  Square,
  PencilSimpleLine,
  ListChecks,
  Lightning,
  RadioButton,
  Circle,
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
  /** Pre-fill selections from a previous submission (re-edit flow). */
  initialAnswers?: Record<string, string>;
  /** Override the submit button label (default: "Optimize"). */
  submitLabel?: string;
  /** Override the skip button label (default: "Skip — just optimize"). */
  skipLabel?: string;
}

/**
 * Parse a comma-joined answer string back into a set of selected options
 * and leftover "other" text that doesn't match any known option.
 */
function parseAnswerToSelections(
  answerStr: string,
  options: string[],
): { selected: Set<string>; otherText: string } {
  const parts = answerStr.split(", ");
  const optionSet = new Set(options);
  const selected = new Set<string>();
  const otherParts: string[] = [];
  for (const part of parts) {
    if (optionSet.has(part)) selected.add(part);
    else if (part) otherParts.push(part);
  }
  return { selected, otherText: otherParts.join(", ") };
}

function OptionGroup({
  q,
  compact,
  selections,
  otherActive,
  otherTexts,
  isDeliveryQuestion,
  toggleOption,
  toggleOther,
  setOtherTexts,
}: {
  q: ClarifyQuestion;
  compact: boolean;
  selections: Record<string, Set<string>>;
  otherActive: Record<string, boolean>;
  otherTexts: Record<string, string>;
  isDeliveryQuestion: (q: ClarifyQuestion) => boolean;
  toggleOption: (qId: string, option: string, singleSelect?: boolean) => void;
  toggleOther: (qId: string) => void;
  setOtherTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const isSingleSelect = isDeliveryQuestion(q);
  const filteredOpts = q.options.filter(
    (o) => o.toLowerCase().trim() !== "other"
  );

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          "gap-1.5",
          compact ? "flex flex-col" : "grid grid-cols-2"
        )}
      >
        {filteredOpts.map((opt) => {
          const selected = selections[q.id]?.has(opt) ?? false;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggleOption(q.id, opt, isSingleSelect)}
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
              {isSingleSelect ? (
                selected ? (
                  <RadioButton
                    size={compact ? 14 : 16}
                    weight="fill"
                    className="text-primary flex-shrink-0 transition-transform duration-200 scale-110"
                  />
                ) : (
                  <Circle
                    size={compact ? 14 : 16}
                    weight="regular"
                    className="text-muted-foreground/30 flex-shrink-0 group-hover:text-muted-foreground/50 transition-colors"
                  />
                )
              ) : selected ? (
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

        {!isSingleSelect && (
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
        )}
      </div>

      {!isSingleSelect && otherActive[q.id] && (
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
            compact
              ? "px-2.5 py-2 text-[11px] rounded-lg"
              : "px-3.5 py-2.5 text-xs rounded-xl"
          )}
        />
      )}
    </div>
  );
}

export const ClarificationCard = ({
  questions,
  isComplex,
  suggestedSections,
  onSubmit,
  onSkip,
  compact = false,
  initialAnswers,
  submitLabel = "Optimize",
  skipLabel = "Skip — just optimize",
}: ClarificationCardProps) => {
  const [selections, setSelections] = useState<Record<string, Set<string>>>(() => {
    if (!initialAnswers) return {};
    const sel: Record<string, Set<string>> = {};
    for (const q of questions) {
      if (q.type !== "multiple_choice") continue;
      const raw = initialAnswers[q.question] || "";
      if (!raw) continue;
      const { selected } = parseAnswerToSelections(raw, q.options);
      if (selected.size > 0) sel[q.id] = selected;
    }
    return sel;
  });
  const [otherActive, setOtherActive] = useState<Record<string, boolean>>(() => {
    if (!initialAnswers) return {};
    const oa: Record<string, boolean> = {};
    for (const q of questions) {
      if (q.type !== "multiple_choice") continue;
      const raw = initialAnswers[q.question] || "";
      if (!raw) continue;
      const { otherText } = parseAnswerToSelections(raw, q.options);
      if (otherText) oa[q.id] = true;
    }
    return oa;
  });
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>(() => {
    if (!initialAnswers) return {};
    const ot: Record<string, string> = {};
    for (const q of questions) {
      if (q.type !== "multiple_choice") continue;
      const raw = initialAnswers[q.question] || "";
      if (!raw) continue;
      const { otherText } = parseAnswerToSelections(raw, q.options);
      if (otherText) ot[q.id] = otherText;
    }
    return ot;
  });
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>(() => {
    if (!initialAnswers) return {};
    const ta: Record<string, string> = {};
    for (const q of questions) {
      if (q.type === "multiple_choice") continue;
      const raw = initialAnswers[q.question] || "";
      if (raw) ta[q.id] = raw;
    }
    return ta;
  });
  const [extraNotes, setExtraNotes] = useState(() => initialAnswers?.["Additional context"] || "");
  const [submitted, setSubmitted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Stepper: 0..questions.length-1 = individual questions, questions.length = final step
  const totalSteps = questions.length + 1;
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const isFinalStep = currentStep === questions.length;

  const goNext = useCallback(() => {
    if (currentStep < questions.length) {
      setDirection('forward');
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep, questions.length]);

  const goPrev = useCallback(() => {
    if (currentStep > 0) {
      setDirection('back');
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  const isDeliveryQuestion = useCallback((q: ClarifyQuestion) => {
    return (
      q.id === "delivery_format" ||
      q.question.toLowerCase().includes("task sections") ||
      q.question.toLowerCase().includes("broken into") ||
      q.question.toLowerCase().includes("delivery") ||
      q.question.toLowerCase().includes("one complete")
    );
  }, []);

  const toggleOption = useCallback((qId: string, option: string, singleSelect?: boolean) => {
    setSelections((prev) => {
      if (singleSelect) {
        const current = new Set(prev[qId] || []);
        if (current.has(option) && current.size === 1) {
          current.delete(option);
        } else {
          return { ...prev, [qId]: new Set([option]) };
        }
        return { ...prev, [qId]: current };
      }
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
    Sentry.addBreadcrumb({ category: 'clarification', message: 'Clarification submitted', level: 'info', data: { questionCount: questions.length, answeredCount } });
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

    Sentry.addBreadcrumb({ category: 'clarification', message: 'Answers finalized', level: 'info', data: { answerCount: Object.keys(finalAnswers).length, wantsSections, hasExtraNotes: !!extraNotes.trim() } });
    onSubmit(finalAnswers, wantsSections);
  }, [questions, selections, otherActive, otherTexts, textAnswers, extraNotes, onSubmit, answeredCount]);

  if (submitted) return null;

  const currentQ = currentStep < questions.length ? questions[currentStep] : null;

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
            <div className="flex items-center justify-between">
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
              {questions.length > 1 && (
                <span className={cn(
                  "text-muted-foreground/50 font-medium tabular-nums",
                  compact ? "text-[10px]" : "text-[11px]"
                )}>
                  {Math.min(currentStep + 1, questions.length)} / {questions.length}
                </span>
              )}
            </div>
            <p className={cn(
              "text-muted-foreground/70 mt-0.5",
              compact ? "text-[10px] ml-[21px]" : "text-[11px] ml-[23px]"
            )}>
              {isFinalStep ? "Almost done — anything to add?" : "Pick all that apply — select multiple if you want"}
            </p>
          </div>

          {/* ── Progress bar ── */}
          {questions.length > 1 && (
            <div className={cn(
              "flex items-center gap-1.5",
              compact ? "px-3.5 pb-2" : "px-5 pb-3"
            )}>
              {questions.map((q, i) => {
                const hasAnswer =
                  q.type === "multiple_choice"
                    ? (selections[q.id]?.size ?? 0) > 0 || otherActive[q.id]
                    : !!textAnswers[q.id];
                const isCurrent = i === currentStep;
                return (
                  <div
                    key={q.id}
                    className={cn(
                      "h-1 rounded-full transition-all duration-500",
                      isCurrent
                        ? "bg-primary/60 flex-[2]"
                        : hasAnswer
                          ? "bg-primary flex-[2]"
                          : i < currentStep
                            ? "bg-border flex-1"
                            : "bg-border/60 flex-1"
                    )}
                  />
                );
              })}
            </div>
          )}

          {/* ── Step content ── */}
          <div className={cn(
            compact ? "px-3.5 pb-1.5" : "px-5 pb-2"
          )}>
            {currentQ ? (
              <div
                key={currentQ.id}
                className={cn(
                  "transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  direction === 'forward'
                    ? "animate-[slideInRight_300ms_ease-out]"
                    : "animate-[slideInLeft_300ms_ease-out]"
                )}
              >
                <p className={cn(
                  "font-medium text-foreground leading-snug",
                  compact ? "text-[12px] mb-2" : "text-[13px] mb-2.5"
                )}>
                  {currentQ.question}
                </p>

                {currentQ.type === "multiple_choice" && currentQ.options.length > 0 ? (
                  <OptionGroup
                    q={currentQ}
                    compact={compact}
                    selections={selections}
                    otherActive={otherActive}
                    otherTexts={otherTexts}
                    isDeliveryQuestion={isDeliveryQuestion}
                    toggleOption={toggleOption}
                    toggleOther={toggleOther}
                    setOtherTexts={setOtherTexts}
                  />
                ) : (
                  <input
                    type="text"
                    placeholder="Type your answer..."
                    value={textAnswers[currentQ.id] || ""}
                    onChange={(e) =>
                      setTextAnswers((prev) => ({
                        ...prev,
                        [currentQ.id]: e.target.value,
                      }))
                    }
                    className={cn(
                      "w-full text-foreground placeholder:text-muted-foreground/40 transition-all bg-muted/40 border border-transparent focus:border-primary/30 focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary/15",
                      compact ? "px-2.5 py-2 text-[11px] rounded-lg" : "px-3.5 py-2.5 text-xs rounded-xl"
                    )}
                  />
                )}

                {/* ── Nav row ── */}
                <div className={cn(
                  "flex items-center justify-between",
                  compact ? "mt-3 pt-2" : "mt-4 pt-2.5",
                  "border-t border-border/20"
                )}>
                  <button
                    type="button"
                    onClick={goPrev}
                    disabled={currentStep === 0}
                    className={cn(
                      "inline-flex items-center gap-1 transition-colors",
                      compact ? "text-[10px]" : "text-[11px]",
                      currentStep === 0
                        ? "text-muted-foreground/20 cursor-default"
                        : "text-muted-foreground/60 hover:text-foreground"
                    )}
                  >
                    <CaretLeft size={compact ? 10 : 12} weight="bold" />
                    Back
                  </button>

                  <button
                    type="button"
                    onClick={goNext}
                    className={cn(
                      "inline-flex items-center gap-1 font-medium transition-colors",
                      compact ? "text-[10px]" : "text-[11px]",
                      "text-muted-foreground/60 hover:text-foreground"
                    )}
                  >
                    {currentStep < questions.length - 1 ? "Next" : "Finish"}
                    <CaretRight size={compact ? 10 : 12} weight="bold" />
                  </button>
                </div>
              </div>
            ) : (
              /* ── Final step: "Anything else?" + suggested sections ── */
              <div
                key="final-step"
                className="animate-[slideInRight_300ms_ease-out]"
              >
                {isComplex && suggestedSections.length > 0 && (
                  <div
                    className={cn(
                      "flex items-start gap-2.5 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/10 mb-3",
                      compact ? "px-2.5 py-2" : "px-3.5 py-3"
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
            )}
          </div>

          {/* ── Footer ── */}
          <div
            className={cn(
              "border-t border-border/30 flex items-center justify-between",
              compact ? "px-3.5 py-2" : "px-5 py-3"
            )}
          >
            <button
              type="button"
              onClick={() => {
                Sentry.addBreadcrumb({ category: 'clarification', message: 'Clarification skipped', level: 'info', data: { questionCount: questions.length, currentStep } });
                onSkip();
              }}
              className={cn(
                "inline-flex items-center gap-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors",
                compact ? "text-[10px]" : "text-[11px]"
              )}
            >
              {skipLabel}
              <ArrowRight size={compact ? 9 : 10} weight="bold" />
            </button>

            {isFinalStep ? (
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
                {submitLabel}
              </button>
            ) : (
              <button
                type="button"
                onClick={goPrev}
                disabled={currentStep === 0}
                className={cn(
                  "inline-flex items-center gap-1 transition-colors",
                  compact ? "text-[10px]" : "text-[11px]",
                  currentStep === 0
                    ? "text-transparent cursor-default pointer-events-none"
                    : "text-muted-foreground/50 hover:text-muted-foreground"
                )}
              >
                <ArrowLeft size={compact ? 9 : 10} weight="bold" />
                Previous
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

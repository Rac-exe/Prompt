import { useState, useCallback } from "react";
import {
  Sparkle,
  PencilSimpleLine,
} from "@phosphor-icons/react";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";
import { ClarificationCard, type ClarifyQuestion } from "./ClarificationCard";

const DELIVERY_KW = ['task sections', 'broken into', 'delivery', 'one complete', 'delivered'];
const isDeliveryQ = (q: string) => DELIVERY_KW.some(k => q.toLowerCase().includes(k));

interface ClarificationSummaryCardProps {
  info: {
    questions: ClarifyQuestion[];
    answers: Record<string, string>;
    mode: 'single' | 'tasks';
  };
  onReoptimize?: (answers: Record<string, string>, wantsSections: boolean) => void;
  isGenerating?: boolean;
}

export const ClarificationSummaryCard = ({
  info,
  onReoptimize,
  isGenerating,
}: ClarificationSummaryCardProps) => {
  const { questions, answers, mode } = info;
  const [editing, setEditing] = useState(false);

  const visibleQuestions = questions.filter(q => !isDeliveryQ(q.question));

  const startEditing = useCallback(() => setEditing(true), []);
  const cancelEditing = useCallback(() => setEditing(false), []);

  const handleReoptimize = useCallback((newAnswers: Record<string, string>, wantsSections: boolean) => {
    setEditing(false);
    onReoptimize?.(newAnswers, wantsSections);
  }, [onReoptimize]);

  // ── Edit mode: render the full ClarificationCard pre-filled ──
  if (editing) {
    return (
      <ClarificationCard
        questions={questions}
        isComplex={false}
        suggestedSections={[]}
        onSubmit={handleReoptimize}
        onSkip={cancelEditing}
        initialAnswers={answers}
        submitLabel="Re-optimize"
        skipLabel="Cancel"
      />
    );
  }

  // ── View mode ──────────────────────────────────────────────
  const answeredQuestions = visibleQuestions.filter(q => answers[q.question]);
  if (answeredQuestions.length === 0 && !mode) return null;

  return (
    <div className="flex gap-3 max-w-4xl mx-auto w-full animate-slide-up">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
        <Logo className="w-3.5 h-3.5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-5 pt-4 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkle size={15} weight="fill" className="text-amber-500" />
              <h3 className="text-[13px] font-semibold text-foreground tracking-tight">
                Your preferences
              </h3>
              {/* Mode pill */}
              <div className={cn(
                "px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase",
                mode === 'tasks'
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-muted text-muted-foreground"
              )}>
                {mode === 'tasks' ? 'Tasks' : 'Single'}
              </div>
            </div>
            {onReoptimize && !isGenerating && (
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-muted/50"
              >
                <PencilSimpleLine size={12} weight="light" />
                Edit choices
              </button>
            )}
          </div>

          {/* Answers list */}
          <div className="px-5 pb-4 space-y-2.5">
            {answeredQuestions.map((q) => (
              <div key={q.id}>
                <div className="text-[10px] font-medium text-muted-foreground/60 mb-1 leading-snug">
                  {q.question}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {answers[q.question].split(", ").map((val, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center px-2.5 py-1 rounded-lg bg-primary/[0.06] border border-primary/20 text-[11px] font-medium text-foreground"
                    >
                      {val}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {answers["Additional context"] && (
              <div>
                <div className="text-[10px] font-medium text-muted-foreground/60 mb-1 leading-snug">
                  Additional context
                </div>
                <p className="text-xs text-foreground/80 leading-relaxed">
                  {answers["Additional context"]}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

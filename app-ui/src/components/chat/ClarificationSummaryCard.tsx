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

  const startEditing = useCallback(() => {
    setEditing(true);
  }, []);
  const cancelEditing = useCallback(() => {
    setEditing(false);
  }, []);

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
    <div className="flex justify-end max-w-4xl mx-auto w-full animate-slide-up">
      <div className="min-w-0 max-w-md">
        <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-3.5 pt-2.5 pb-2 flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <Sparkle size={13} weight="fill" className="text-amber-500" />
              <h3 className="text-[12px] font-semibold text-foreground tracking-tight">
                Your preferences
              </h3>
              <div className={cn(
                "px-2 py-px rounded-full text-[9px] font-semibold tracking-wide uppercase",
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
                className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors px-1.5 py-0.5 rounded-md hover:bg-muted/50"
              >
                <PencilSimpleLine size={11} weight="light" />
                Edit
              </button>
            )}
          </div>

          {/* Answers list */}
          <div className="px-3.5 pb-3 space-y-2">
            {answeredQuestions.map((q) => (
              <div key={q.id}>
                <div className="text-[9px] font-medium text-muted-foreground/60 mb-0.5 leading-snug">
                  {q.question}
                </div>
                <div className="flex flex-wrap gap-1">
                  {answers[q.question].split(", ").map((val, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center px-2 py-0.5 rounded-md bg-primary/[0.06] border border-primary/20 text-[10px] font-medium text-foreground"
                    >
                      {val}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {answers["Additional context"] && (
              <div>
                <div className="text-[9px] font-medium text-muted-foreground/60 mb-0.5 leading-snug">
                  Additional context
                </div>
                <p className="text-[11px] text-foreground/80 leading-relaxed">
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

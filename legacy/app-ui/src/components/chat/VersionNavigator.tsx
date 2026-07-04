import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface VersionNavigatorProps {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  /** "left" aligns the arrows to the start (assistant), "right" to the end (user). Default: center. */
  align?: "left" | "right" | "center";
}

export const VersionNavigator = ({ current, total, onPrev, onNext, align = "center" }: VersionNavigatorProps) => {
  if (total <= 1) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-1 py-0.5",
        align === "left" && "justify-start pl-10",   // offset past assistant avatar
        align === "right" && "justify-end pr-10",     // offset past user avatar
        align === "center" && "justify-center",
      )}
    >
      <button
        onClick={onPrev}
        disabled={current <= 1}
        className={cn(
          "w-6 h-6 rounded-md flex items-center justify-center transition-colors",
          current <= 1
            ? "text-muted-foreground/25 cursor-not-allowed"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary"
        )}
        aria-label="Previous version"
      >
        <CaretLeft size={14} weight="light" />
      </button>
      <span className="text-[11px] text-muted-foreground/70 font-medium tabular-nums min-w-[2.5rem] text-center select-none">
        {current} / {total}
      </span>
      <button
        onClick={onNext}
        disabled={current >= total}
        className={cn(
          "w-6 h-6 rounded-md flex items-center justify-center transition-colors",
          current >= total
            ? "text-muted-foreground/25 cursor-not-allowed"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary"
        )}
        aria-label="Next version"
      >
        <CaretRight size={14} weight="light" />
      </button>
    </div>
  );
};

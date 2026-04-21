import { cn } from "@/lib/utils";

/**
 * Indeterminate progress bar shown while a project is being indexed.
 *
 * We deliberately do NOT show a percentage. The backend's project row only
 * exposes a string status (`indexing` / `ready` / …) — there's no
 * chunks-processed / chunks-total signal today. Rather than invent a fake
 * percentage (or freeze a real one partway through the run), we use a
 * Material-style sliding pill that just communicates "work is happening".
 *
 * Two visual variants are supported:
 *   - `inline` — a tiny 20×2 bar that slots in where a status dot would
 *     normally sit (toolbar pills, compact labels). Replaces the
 *     pulsing dot for the `indexing` state; other states keep the dot.
 *   - `block`  — a full-width 4px-tall bar for cards and empty-states
 *     where there's room for a more prominent affordance.
 */
interface IndexingProgressBarProps {
  className?: string;
  variant?: "inline" | "block";
  /** Track + pill color. Defaults to amber to match the existing
   *  `indexing` STATUS_META palette used across Spaces. */
  tone?: "amber" | "emerald";
}

const TONE_CLASSES: Record<NonNullable<IndexingProgressBarProps["tone"]>, { track: string; pill: string }> = {
  amber:   { track: "bg-amber-400/15",   pill: "bg-amber-400/75"   },
  emerald: { track: "bg-emerald-400/15", pill: "bg-emerald-400/75" },
};

export function IndexingProgressBar({
  className,
  variant = "inline",
  tone = "amber",
}: IndexingProgressBarProps) {
  const tones = TONE_CLASSES[tone];
  return (
    <div
      role="progressbar"
      aria-label="Indexing in progress"
      aria-busy="true"
      className={cn(
        "relative overflow-hidden rounded-full",
        tones.track,
        variant === "inline" ? "h-[2px] w-5" : "h-1 w-full",
        className,
      )}
    >
      <div
        className={cn(
          "absolute top-0 bottom-0 rounded-full",
          tones.pill,
          "animate-indexing-slide",
        )}
      />
    </div>
  );
}

export default IndexingProgressBar;

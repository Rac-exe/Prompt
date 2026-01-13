import { PromptSession } from "./session-state";

/**
 * Tracks typing stability to determine when to trigger optimization
 */
export class StabilityTracker {
  private readonly STABILITY_THRESHOLD_MS = 1500;  // 1.5s pause = stable
  private readonly MIN_PROMPT_LENGTH = 10;         // Min 10 chars
  private readonly MAX_EDIT_FREQUENCY = 5;         // Max 5 edits/sec

  private editTimestamps: number[] = [];

  /**
   * Check if session is stable enough to optimize
   */
  isStable(session: PromptSession, now: number): boolean {
    const timeSinceEdit = now - session.lastEditAt;

    // Not enough pause time
    if (timeSinceEdit < this.STABILITY_THRESHOLD_MS) {
      return false;
    }

    // Prompt too short
    if (session.promptText.length < this.MIN_PROMPT_LENGTH) {
      return false;
    }

    // User typing too fast (likely still editing)
    const recentEdits = this.editTimestamps.filter(
      t => now - t < 1000
    );
    if (recentEdits.length > this.MAX_EDIT_FREQUENCY) {
      return false;
    }

    return true;
  }

  /**
   * Record an edit event
   */
  recordEdit(now: number) {
    this.editTimestamps.push(now);

    // Keep only last 2 seconds of history
    this.editTimestamps = this.editTimestamps.filter(
      t => now - t < 2000
    );
  }

  /**
   * Reset tracker state
   */
  reset() {
    this.editTimestamps = [];
  }

  /**
   * Get stability configuration
   */
  getConfig() {
    return {
      stabilityThresholdMs: this.STABILITY_THRESHOLD_MS,
      minPromptLength: this.MIN_PROMPT_LENGTH,
      maxEditFrequency: this.MAX_EDIT_FREQUENCY
    };
  }
}

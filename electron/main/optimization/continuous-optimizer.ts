import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import {
  PromptSession,
  SessionPhase,
  createSession,
  updateSession,
  markStable,
  markOptimizing,
  markShowing,
  updateStability
} from "./session-state";
import { StabilityTracker } from "./stability-tracker";
import { AIGuardrails } from "./ai-guardrails";
import { ResponseValidator } from "./response-validator";
import { OverlayManager } from "../overlay/overlay-manager";
import { WindowTracker } from "../context/window-tracker";

/**
 * Continuous optimizer orchestrator
 * Manages the prompt optimization lifecycle with state machine
 */
export class ContinuousOptimizer extends EventEmitter {
  private session: PromptSession | null = null;
  private orchestrationTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  private readonly ORCHESTRATION_INTERVAL_MS = 100;  // Check every 100ms

  private stabilityTracker: StabilityTracker;
  private guardrails: AIGuardrails;
  private validator: ResponseValidator;
  private overlayManager: OverlayManager;
  private windowTracker: WindowTracker;

  constructor(
    stabilityTracker: StabilityTracker,
    guardrails: AIGuardrails,
    validator: ResponseValidator,
    overlayManager: OverlayManager,
    windowTracker: WindowTracker
  ) {
    super();
    this.stabilityTracker = stabilityTracker;
    this.guardrails = guardrails;
    this.validator = validator;
    this.overlayManager = overlayManager;
    this.windowTracker = windowTracker;
  }

  /**
   * Start the orchestration loop
   */
  startOrchestration() {
    if (this.isRunning) {
      return;
    }

    console.log("[ContinuousOptimizer] Starting orchestration loop");

    this.orchestrationTimer = setInterval(() => {
      this.orchestrationLoop();
    }, this.ORCHESTRATION_INTERVAL_MS);

    this.isRunning = true;
  }

  /**
   * Stop the orchestration loop
   */
  stopOrchestration() {
    if (!this.isRunning) {
      return;
    }

    console.log("[ContinuousOptimizer] Stopping orchestration loop");

    if (this.orchestrationTimer) {
      clearInterval(this.orchestrationTimer);
      this.orchestrationTimer = null;
    }

    this.isRunning = false;
  }

  /**
   * Main orchestration loop - runs state machine transitions
   */
  private orchestrationLoop() {
    if (!this.session) {
      return;
    }

    const now = Date.now();

    // Update stability duration
    this.session = updateStability(this.session, now);

    // PHASE TRANSITION: DETECTING → STABLE
    if (
      this.session.phase === SessionPhase.DETECTING &&
      this.stabilityTracker.isStable(this.session, now)
    ) {
      console.log(
        `[ContinuousOptimizer] Prompt stabilized after ${this.session.stableFor}ms`,
        `"${this.session.promptText.substring(0, 50)}..."`
      );
      this.session = markStable(this.session, now);
      this.emit("session-stable", this.session);
    }

    // PHASE TRANSITION: STABLE → OPTIMIZING
    if (this.session.phase === SessionPhase.STABLE) {
      this.attemptOptimization();
    }
  }

  /**
   * Attempt to start optimization if guardrails allow
   */
  private async attemptOptimization() {
    if (!this.session) {
      return;
    }

    const shouldOptimize = await this.guardrails.shouldOptimize(
      this.session.promptText,
      this.session
    );

    if (shouldOptimize) {
      await this.startOptimization();
    }
  }

  /**
   * Start AI optimization request
   */
  private async startOptimization() {
    if (!this.session) {
      return;
    }

    const requestId = randomUUID();
    const promptText = this.session.promptText;

    console.log(
      `[ContinuousOptimizer] Starting optimization`,
      `requestId: ${requestId}`,
      `prompt: "${promptText.substring(0, 50)}..."`
    );

    this.session = markOptimizing(this.session, requestId);
    this.validator.cacheRequest(requestId, promptText);
    this.emit("optimization-started", this.session);

    // Show loading indicator
    this.showLoadingOverlay();

    try {
      const optimized = await this.guardrails.optimize(promptText, requestId);

      console.log(
        `[ContinuousOptimizer] Optimization completed`,
        `requestId: ${requestId}`,
        `optimized length: ${optimized.length}`
      );

      // Validate response is still relevant
      if (!this.validator.validate(optimized, requestId, this.session)) {
        console.log(`[ContinuousOptimizer] Discarding stale response`);
        return;
      }

      // Update session
      this.session = markShowing(this.session, optimized);
      this.emit("optimization-completed", this.session);

      // Show result overlay
      this.showResultOverlay(promptText, optimized);

    } catch (error) {
      console.error(`[ContinuousOptimizer] Optimization failed:`, error);

      if (this.session && this.session.aiRequestId === requestId) {
        // Reset to stable phase to retry
        this.session = markStable(this.session, Date.now());
        this.emit("optimization-failed", error);

        // Show error overlay
        this.showErrorOverlay();
      }
    }
  }

  /**
   * Handle text change from poller
   */
  onTextChanged(promptText: string, triggerIndex: number) {
    const now = Date.now();

    if (!this.session) {
      // Create new session
      this.session = createSession(promptText, triggerIndex, now);
      console.log(
        `[ContinuousOptimizer] New session created`,
        `"${promptText.substring(0, 50)}..."`
      );
      this.emit("session-created", this.session);
    } else {
      // Only update if text actually changed
      if (this.session.promptText !== promptText) {
        // Update existing session
        this.session = updateSession(this.session, promptText, now);
        this.stabilityTracker.recordEdit(now);

        console.log(
          `[ContinuousOptimizer] Session updated (edit #${this.session.editCount})`,
          `"${promptText.substring(0, 50)}..."`
        );
        this.emit("session-updated", this.session);

        // Hide existing overlays when text changes
        this.hideOverlays();
      }
      // If text is the same, do nothing - let stability tracker continue counting
    }
  }

  /**
   * Optimize immediately without waiting for stability (for manual input like floating panel)
   */
  async optimizeImmediately(promptText: string) {
    const now = Date.now();

    console.log(
      `[ContinuousOptimizer] Immediate optimization requested`,
      `"${promptText.substring(0, 50)}..."`
    );

    // Create or update session
    if (!this.session || this.session.promptText !== promptText) {
      this.session = createSession(promptText, 0, now);
      // Mark as immediately stable
      this.session = markStable(this.session, now);
      this.emit("session-created", this.session);
    }

    // Check guardrails
    const shouldOptimize = await this.guardrails.shouldOptimize(
      promptText,
      this.session
    );

    if (!shouldOptimize) {
      console.log(`[ContinuousOptimizer] Immediate optimization blocked by guardrails`);
      return;
    }

    // Start optimization immediately
    await this.startOptimization();
  }

  /**
   * Handle trigger removal
   */
  onTriggerRemoved() {
    if (this.session) {
      console.log(`[ContinuousOptimizer] Trigger removed, resetting session`);
      this.session = null;
      this.stabilityTracker.reset();
      this.hideOverlays();
      this.emit("session-reset");
    }
  }

  /**
   * Show loading overlay
   */
  private showLoadingOverlay() {
    if (!this.session) {
      return;
    }

    const context = this.createPromptContext();
    if (context) {
      this.overlayManager.showHighlight(context, { loading: true });
    }
  }

  /**
   * Show result overlay
   */
  private showResultOverlay(original: string, optimized: string) {
    const context = this.createPromptContext();
    if (context) {
      this.overlayManager.showOptimization(context, original, optimized);
    }
  }

  /**
   * Show error overlay
   */
  private showErrorOverlay() {
    const context = this.createPromptContext();
    if (context) {
      this.overlayManager.showError(context, "Failed to optimize. Please try again.");
    }
  }

  /**
   * Hide all overlays
   */
  private hideOverlays() {
    const context = this.createPromptContext();
    if (context) {
      this.overlayManager.hide(context);
    }
  }

  /**
   * Create PromptContext for overlay manager
   */
  private createPromptContext() {
    if (!this.session) {
      return null;
    }

    const window = this.windowTracker.getCurrentContext();
    if (!window) {
      console.warn("[ContinuousOptimizer] No window context available");
      return null;
    }

    // Estimate cursor position (simplified)
    const estimatedCursorX = window.bounds.x + 50;
    const estimatedCursorY = window.bounds.y + 100;

    return {
      window,
      promptText: this.session.promptText,
      estimatedCursorX,
      estimatedCursorY,
      timestamp: this.session.detectedAt
    };
  }

  /**
   * Get current session
   */
  getCurrentSession(): PromptSession | null {
    return this.session;
  }

  /**
   * Cleanup
   */
  cleanup() {
    this.stopOrchestration();
    this.session = null;
    this.stabilityTracker.reset();
    this.guardrails.clear();
    this.validator.clear();
  }
}

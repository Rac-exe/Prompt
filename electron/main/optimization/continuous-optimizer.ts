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
  // Multi-instance support: Track multiple prompt instances by hash
  private promptInstances = new Map<string, {
    instanceHash: string;
    session: PromptSession;
    isOptimized: boolean;
  }>();

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
   * Main orchestration loop - runs state machine transitions for ALL instances
   */
  private orchestrationLoop() {
    if (this.promptInstances.size === 0) {
      return;
    }

    const now = Date.now();

    // Process each prompt instance independently
    this.promptInstances.forEach((instance, hash) => {
      // Skip if already optimized
      if (instance.isOptimized) {
        return;
      }

      // Update stability duration
      instance.session = updateStability(instance.session, now);

      // PHASE TRANSITION: DETECTING → STABLE
      if (
        instance.session.phase === SessionPhase.DETECTING &&
        this.stabilityTracker.isStable(instance.session, now)
      ) {
        // console.log(
        //   `[ContinuousOptimizer] Instance ${hash.substring(0, 20)}... stabilized after ${instance.session.stableFor}ms`,
        //   `"${instance.session.promptText.substring(0, 50)}..."`
        // );
        instance.session = markStable(instance.session, now);
        this.emit("session-stable", instance.session);
      }

      // PHASE TRANSITION: STABLE → OPTIMIZING
      if (instance.session.phase === SessionPhase.STABLE) {
        this.attemptOptimization(instance, hash);
      }
    });
  }

  /**
   * Attempt to start optimization if guardrails allow
   */
  private async attemptOptimization(
    instance: { instanceHash: string; session: PromptSession; isOptimized: boolean },
    hash: string
  ) {
    const shouldOptimize = await this.guardrails.shouldOptimize(
      instance.session.promptText,
      instance.session
    );

    if (shouldOptimize) {
      await this.startOptimization(instance, hash);
    }
  }

  /**
   * Start AI optimization request for a specific instance
   */
  private async startOptimization(
    instance: { instanceHash: string; session: PromptSession; isOptimized: boolean },
    hash: string
  ) {
    const requestId = randomUUID();
    const promptText = instance.session.promptText;

    // console.log(
    //   `[ContinuousOptimizer] Starting optimization for instance ${hash.substring(0, 20)}...`,
    //   `requestId: ${requestId}`,
    //   `prompt: "${promptText.substring(0, 50)}..."`
    // );

    instance.session = markOptimizing(instance.session, requestId);
    this.validator.cacheRequest(requestId, promptText);
    this.emit("optimization-started", instance.session);

    // Show loading indicator
    this.showLoadingOverlay(instance.session);

    try {
      const optimized = await this.guardrails.optimize(promptText, requestId);

      // console.log(
      //   `[ContinuousOptimizer] Optimization completed for instance ${hash.substring(0, 20)}...`,
      //   `requestId: ${requestId}`,
      //   `optimized length: ${optimized.length}`
      // );

      // Validate response is still relevant
      if (!this.validator.validate(optimized, requestId, instance.session)) {
        // console.log(`[ContinuousOptimizer] Discarding stale response`);
        return;
      }

      // Update session and mark as optimized
      instance.session = markShowing(instance.session, optimized);
      instance.isOptimized = true;
      this.emit("optimization-completed", instance.session);

      // Show result overlay
      this.showResultOverlay(promptText, optimized, instance.session);

      // Mark instance as optimized to prevent re-optimization
      // console.log(`[ContinuousOptimizer] Instance ${hash.substring(0, 20)}... marked as optimized`);


    } catch (error) {
      console.error(`[ContinuousOptimizer] Optimization failed for instance ${hash.substring(0, 20)}...:`, error);

      if (instance.session.aiRequestId === requestId) {
        // Reset to stable phase to retry
        instance.session = markStable(instance.session, Date.now());
        instance.isOptimized = false;
        this.emit("optimization-failed", error);

        // Show error overlay
        this.showErrorOverlay(instance.session);
      }
    }
  }

  /**
   * Handle text change from poller - manages multiple prompt instances
   * @param promptText The text after @prompt
   * @param triggerIndex Position in buffer
   * @param instanceHash Unique hash for this instance
   */
  onTextChanged(promptText: string, triggerIndex: number, instanceHash: string) {
    const now = Date.now();

    // Check if we already have this instance
    let instance = this.promptInstances.get(instanceHash);

    if (!instance) {
      // NEW instance - create session
      const session = createSession(promptText, triggerIndex, now);
      instance = {
        instanceHash,
        session,
        isOptimized: false
      };
      this.promptInstances.set(instanceHash, instance);

      // console.log(
      //   `[ContinuousOptimizer] New instance created ${instanceHash.substring(0, 20)}...`,
      //   `"${promptText.substring(0, 50)}..."`
      // );
      this.emit("session-created", session);
    } else {
      // EXISTING instance
      if (instance.isOptimized) {
        // Already optimized - check if text changed
        if (instance.session.promptText !== promptText) {
          // console.log(
          //   `[ContinuousOptimizer] Optimized instance text changed ${instanceHash.substring(0, 20)}...`,
          //   `"${promptText.substring(0, 50)}..."`
          // );
          // Text changed - reset to DETECTING
          instance.session = createSession(promptText, triggerIndex, now);
          instance.isOptimized = false;
          this.emit("session-created", instance.session);
        }
        // Same text - keep optimized, do nothing
      } else {
        // Not yet optimized - update session if text changed
        if (instance.session.promptText !== promptText) {
          instance.session = updateSession(instance.session, promptText, now);
          this.stabilityTracker.recordEdit(now);

          // console.log(
          //   `[ContinuousOptimizer] Instance updated ${instanceHash.substring(0, 20)}... (edit #${instance.session.editCount})`,
          //   `"${promptText.substring(0, 50)}..."`
          // );
          this.emit("session-updated", instance.session);
        }
      }
    }
  }

  /**
   * Handle instance removal from poller
   */
  onInstanceRemoved(instanceHash: string) {
    if (this.promptInstances.has(instanceHash)) {
      // console.log(`[ContinuousOptimizer] Removing instance ${instanceHash.substring(0, 20)}...`);
      this.promptInstances.delete(instanceHash);
      this.emit("session-reset");
    }
  }

  /**
   * Optimize immediately without waiting for stability (for manual input like floating panel)
   * @param promptText - The text to optimize
   * @param forceBypassGuardrails - If true, skip guardrails (for refresh button)
   */
  async optimizeImmediately(promptText: string, forceBypassGuardrails: boolean = false) {
    const now = Date.now();

    console.log(
      `[ContinuousOptimizer] Immediate optimization requested`,
      `"${promptText.substring(0, 50)}..."`,
      forceBypassGuardrails ? "(bypassing guardrails)" : ""
    );

    // Create a special instance for immediate optimization (floating panel)
    const instanceHash = `immediate_${Date.now()}`;
    const session = createSession(promptText, 0, now);
    const stableSession = markStable(session, now);

    const instance = {
      instanceHash,
      session: stableSession,
      isOptimized: false
    };
    this.promptInstances.set(instanceHash, instance);
    this.emit("session-created", stableSession);

    // Check guardrails (unless forced to bypass)
    if (!forceBypassGuardrails) {
      const shouldOptimize = await this.guardrails.shouldOptimize(
        promptText,
        stableSession
      );

      if (!shouldOptimize) {
        console.log(`[ContinuousOptimizer] Immediate optimization blocked by guardrails`);
        return;
      }
    } else {
      console.log(`[ContinuousOptimizer] Bypassing guardrails for forced optimization (refresh button)`);
    }

    // Start optimization immediately
    await this.startOptimization(instance, instanceHash);
  }

  /**
   * Handle all triggers removed (no @prompt in buffer)
   */
  onTriggerRemoved() {
    if (this.promptInstances.size > 0) {
      console.log(`[ContinuousOptimizer] All triggers removed, clearing ${this.promptInstances.size} instances`);
      this.promptInstances.clear();
      this.stabilityTracker.reset();
      this.emit("session-reset");
    }
  }

  /**
   * Show loading overlay for a specific session
   */
  private showLoadingOverlay(session: PromptSession) {
    const context = this.createPromptContext(session);
    if (context) {
      this.overlayManager.showHighlight(context, { loading: true });
    }
  }

  /**
   * Show result overlay for a specific session
   */
  private showResultOverlay(original: string, optimized: string, session: PromptSession) {
    const context = this.createPromptContext(session);
    if (context) {
      this.overlayManager.showOptimization(context, original, optimized);
    }
  }

  /**
   * Show error overlay for a specific session
   */
  private showErrorOverlay(session: PromptSession) {
    const context = this.createPromptContext(session);
    if (context) {
      this.overlayManager.showError(context, "Failed to optimize. Please try again.");
    }
  }

  /**
   * Hide all overlays (no longer used in multi-instance mode)
   */
  private hideOverlays() {
    // DEPRECATED: In multi-instance mode, overlays are managed per-instance
    // This method kept for compatibility but does nothing
  }

  /**
   * Create PromptContext for overlay manager from a session
   */
  private createPromptContext(session: PromptSession) {
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
      promptText: session.promptText,
      estimatedCursorX,
      estimatedCursorY,
      timestamp: session.detectedAt
    };
  }

  /**
   * Get current session (returns first instance if multiple exist)
   */
  getCurrentSession(): PromptSession | null {
    if (this.promptInstances.size === 0) {
      return null;
    }
    return this.promptInstances.values().next().value?.session || null;
  }

  // REMOVED: scheduleSessionReset() and resetCompletedSession()
  // Session now stays alive in SHOWING phase until text changes or trigger is removed
  // This prevents infinite re-optimization of the same prompt

  /**
   * Cleanup
   */
  cleanup() {
    this.stopOrchestration();

    this.promptInstances.clear();
    this.stabilityTracker.reset();
    this.guardrails.clear();
    this.validator.clear();
  }
}

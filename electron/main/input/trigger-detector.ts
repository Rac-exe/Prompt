import { EventEmitter } from "events";
import { WindowTracker, WindowContext } from "../context/window-tracker";
import { TextStatePoller } from "./text-state-poller";
import { ContinuousOptimizer } from "../optimization/continuous-optimizer";
import { StabilityTracker } from "../optimization/stability-tracker";
import { AIGuardrails } from "../optimization/ai-guardrails";
import { ResponseValidator } from "../optimization/response-validator";
import { OverlayManager } from "../overlay/overlay-manager";
import { PythonClient } from "../api/python-client";

export interface PromptContext {
  window: WindowContext;
  promptText: string;
  estimatedCursorX: number;
  estimatedCursorY: number;
  timestamp: number;
}

/**
 * Trigger detector using new continuous optimization architecture
 */
export class TriggerDetector extends EventEmitter {
  public windowTracker: WindowTracker; // Made public for direct access from app.ts
  public textPoller: TextStatePoller; // Made public for direct access from app.ts
  private continuousOptimizer: ContinuousOptimizer;

  constructor(
    pythonClient: PythonClient,
    overlayManager: OverlayManager
  ) {
    super();

    this.windowTracker = new WindowTracker();
    this.textPoller = new TextStatePoller();

    // Initialize continuous optimizer with all components
    const stabilityTracker = new StabilityTracker();
    const guardrails = new AIGuardrails(pythonClient);
    const validator = new ResponseValidator();

    this.continuousOptimizer = new ContinuousOptimizer(
      stabilityTracker,
      guardrails,
      validator,
      overlayManager,
      this.windowTracker
    );

    this.setupListeners();
  }

  private setupListeners() {
    // NEW WORKFLOW: Disable automatic optimization via continuous optimizer
    // The floating panel now handles optimization manually when user clicks Replace
    //
    // OLD WORKFLOW (DISABLED):
    // Listen for trigger events from text poller (now supports multiple instances)
    // this.textPoller.on("trigger-found", (data: any) => {
    //   this.continuousOptimizer.onTextChanged(
    //     data.promptText,
    //     data.triggerIndex,
    //     data.instanceHash
    //   );
    // });

    // this.textPoller.on("trigger-removed", (data: any) => {
    //   this.continuousOptimizer.onInstanceRemoved(data.instanceHash);
    // });

    // this.textPoller.on("trigger-not-found", () => {
    //   this.continuousOptimizer.onTriggerRemoved();
    // });

    // Forward optimizer events
    this.continuousOptimizer.on("session-created", (session) => {
      // console.log("[TriggerDetector] New prompt session created");
      this.emit("session-created", session);
    });

    this.continuousOptimizer.on("session-stable", (session) => {
      // console.log("[TriggerDetector] Prompt session stabilized");
      this.emit("session-stable", session);
    });

    this.continuousOptimizer.on("optimization-started", (session) => {
      // console.log("[TriggerDetector] Optimization started");
      this.emit("optimization-started", session);
    });

    this.continuousOptimizer.on("optimization-completed", (session) => {
      // console.log("[TriggerDetector] Optimization completed");
      this.emit("optimization-completed", session);
    });

    this.continuousOptimizer.on("optimization-failed", (error) => {
      console.error("[TriggerDetector] Optimization failed:", error);
      this.emit("optimization-failed", error);
    });

    // REMOVED: session-auto-reset listener
    // Session now stays alive in SHOWING phase to prevent re-optimization
  }

  start() {
    try {
      console.log("[TriggerDetector] Starting...");

      // Start window tracking
      this.windowTracker.startTracking();

      // Start text state polling
      this.textPoller.start();

      // Start continuous optimization orchestration
      this.continuousOptimizer.startOrchestration();

      console.log("[TriggerDetector] Started successfully");
      console.log("[TriggerDetector] Listening for @prompt triggers...");
    } catch (error) {
      console.error("[TriggerDetector] Failed to start:", error);
      this.emit("error", error);
      throw error;
    }
  }

  stop() {
    console.log("[TriggerDetector] Stopping...");

    this.textPoller.stop();
    this.windowTracker.stopTracking();
    this.continuousOptimizer.cleanup();

    console.log("[TriggerDetector] Stopped");
  }

  /**
   * Manually trigger optimization (for floating panel input or refresh button)
   * Optimizes immediately without waiting for stability
   * @param promptText - The text to optimize
   * @param forceBypassGuardrails - If true, skip guardrails (for refresh button)
   */
  async triggerManualOptimization(promptText: string, forceBypassGuardrails: boolean = false) {
    console.log("[TriggerDetector] Manual optimization triggered:", promptText.substring(0, 50));
    await this.continuousOptimizer.optimizeImmediately(promptText, forceBypassGuardrails);
  }

  /**
   * Clear text buffer after successful replacement
   * This prevents stale @prompt detections after UI Automation replacement
   */
  clearTextBuffer(): void {
    this.textPoller.clearBuffer();
  }

  /**
   * Signal that text replacement is starting
   * Prevents paste detection from triggering during keyboard fallback
   */
  startReplacingText(): void {
    this.textPoller.startReplacingText();
  }

  /**
   * Signal that text replacement is complete
   */
  stopReplacingText(): void {
    this.textPoller.stopReplacingText();
  }
}

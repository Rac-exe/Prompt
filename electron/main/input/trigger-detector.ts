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
  private windowTracker: WindowTracker;
  private textPoller: TextStatePoller;
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
    // Listen for trigger events from text poller
    this.textPoller.on("trigger-found", (data: any) => {
      this.continuousOptimizer.onTextChanged(
        data.promptText,
        data.triggerIndex
      );
    });

    this.textPoller.on("trigger-not-found", () => {
      this.continuousOptimizer.onTriggerRemoved();
    });

    // Forward optimizer events
    this.continuousOptimizer.on("session-created", (session) => {
      console.log("[TriggerDetector] New prompt session created");
      this.emit("session-created", session);
    });

    this.continuousOptimizer.on("session-stable", (session) => {
      console.log("[TriggerDetector] Prompt session stabilized");
      this.emit("session-stable", session);
    });

    this.continuousOptimizer.on("optimization-started", (session) => {
      console.log("[TriggerDetector] Optimization started");
      this.emit("optimization-started", session);
    });

    this.continuousOptimizer.on("optimization-completed", (session) => {
      console.log("[TriggerDetector] Optimization completed");
      this.emit("optimization-completed", session);
    });

    this.continuousOptimizer.on("optimization-failed", (error) => {
      console.error("[TriggerDetector] Optimization failed:", error);
      this.emit("optimization-failed", error);
    });
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
}

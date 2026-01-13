import { TriggerDetector } from "./input/trigger-detector";
import { OverlayManager } from "./overlay/overlay-manager";
import { PythonClient } from "./api/python-client";
import { EventEmitter } from "events";

export class PromptOptimizerApp extends EventEmitter {
  private triggerDetector: TriggerDetector;
  private overlayManager: OverlayManager;
  private pythonClient: PythonClient;
  private isInitialized: boolean = false;

  constructor() {
    super();
    this.overlayManager = new OverlayManager();
    this.pythonClient = new PythonClient("http://127.0.0.1:8000");

    // Initialize trigger detector with dependencies
    this.triggerDetector = new TriggerDetector(
      this.pythonClient,
      this.overlayManager
    );

    this.setupListeners();
  }

  private setupListeners() {
    // Listen to optimization lifecycle events
    this.triggerDetector.on("session-created", (session) => {
      console.log("[App] Prompt session created:", session.promptText.substring(0, 50));
    });

    this.triggerDetector.on("session-stable", (session) => {
      console.log("[App] Prompt stabilized, ready to optimize");
    });

    this.triggerDetector.on("optimization-started", (session) => {
      console.log("[App] Optimization started");
    });

    this.triggerDetector.on("optimization-completed", (session) => {
      console.log("[App] Optimization completed successfully");
    });

    this.triggerDetector.on("optimization-failed", (error: Error) => {
      console.error("[App] Optimization failed:", error);
      this.emit("error", error);
    });

    this.triggerDetector.on("error", (error: Error) => {
      console.error("[App] Trigger detector error:", error);
      this.emit("error", error);
    });
  }

  async initialize() {
    if (this.isInitialized) {
      return;
    }

    console.log("Initializing Prompt Optimizer...");

    // Check Python service is running
    try {
      const isHealthy = await this.pythonClient.healthCheck();
      if (!isHealthy) {
        console.warn("Python service not available. Some features may not work.");
        console.warn("Please start the Python service: npm run python:dev");
      } else {
        console.log("Python service connected");
      }
    } catch (error) {
      console.warn("Could not connect to Python service:", error);
    }

    // Start keyboard monitoring
    try {
      this.triggerDetector.start();
      console.log("Keyboard monitoring started");
    } catch (error) {
      console.error("Failed to start keyboard monitoring:", error);
      throw error;
    }

    this.isInitialized = true;
    console.log("Prompt Optimizer initialized successfully");
    this.emit("initialized");
  }

  async shutdown() {
    console.log("Shutting down Prompt Optimizer...");
    
    try {
      this.triggerDetector.stop();
      this.overlayManager.cleanup();
      console.log("Shutdown complete");
    } catch (error) {
      console.error("Error during shutdown:", error);
    }
  }
}

import { TriggerDetector, PromptContext } from "./input/trigger-detector";
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
    this.triggerDetector = new TriggerDetector();
    this.overlayManager = new OverlayManager();
    this.pythonClient = new PythonClient("http://127.0.0.1:8000");
    this.setupListeners();
  }

  private setupListeners() {
    this.triggerDetector.on("prompt-captured", async (context: PromptContext) => {
      await this.handlePrompt(context);
    });

    this.triggerDetector.on("error", (error: Error) => {
      console.error("Trigger detector error:", error);
      this.emit("error", error);
    });
  }

  private async handlePrompt(context: PromptContext) {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [handlePrompt] START - Processing prompt: "${context.promptText}"`);
    console.log(`[${timestamp}] [handlePrompt] Window: "${context.window.title}"`);
    console.log(`[${timestamp}] [handlePrompt] Window bounds:`, context.window.bounds);
    console.log(`[${timestamp}] [handlePrompt] Estimated cursor: x=${context.estimatedCursorX}, y=${context.estimatedCursorY}`);

    // Show loading indicator
    const highlightStartTime = Date.now();
    console.log(`[${timestamp}] [handlePrompt] Calling overlayManager.showHighlight()...`);
    try {
      this.overlayManager.showHighlight(context, { loading: true });
      const highlightElapsed = Date.now() - highlightStartTime;
      console.log(`[${timestamp}] [handlePrompt] ✓ overlayManager.showHighlight() completed in ${highlightElapsed}ms`);
    } catch (error) {
      console.error(`[${timestamp}] [handlePrompt] ✗ overlayManager.showHighlight() failed:`, error);
    }

    try {
      // Optimize prompt with timeout
      const optimizeStartTime = Date.now();
      console.log(`[${new Date().toISOString()}] [handlePrompt] Calling pythonClient.optimize()...`);
      
      const optimized = await Promise.race([
        this.pythonClient.optimize(context.promptText),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout after 10 seconds")), 10000)
        )
      ]);

      const optimizeElapsed = Date.now() - optimizeStartTime;
      console.log(`[${new Date().toISOString()}] [handlePrompt] ✓ pythonClient.optimize() completed in ${optimizeElapsed}ms`);
      console.log(`[${new Date().toISOString()}] [handlePrompt] Optimized text length: ${optimized.length} chars`);

      // Show overlay with optimized text
      const showOptStartTime = Date.now();
      console.log(`[${new Date().toISOString()}] [handlePrompt] Calling overlayManager.showOptimization()...`);
      try {
        this.overlayManager.showOptimization(
          context,
          context.promptText,
          optimized
        );
        const showOptElapsed = Date.now() - showOptStartTime;
        console.log(`[${new Date().toISOString()}] [handlePrompt] ✓ overlayManager.showOptimization() completed in ${showOptElapsed}ms`);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [handlePrompt] ✗ overlayManager.showOptimization() failed:`, error);
      }
      
      const totalElapsed = Date.now() - startTime;
      console.log(`[${new Date().toISOString()}] [handlePrompt] ✓ COMPLETE - Total time: ${totalElapsed}ms`);
    } catch (error) {
      const totalElapsed = Date.now() - startTime;
      console.error(`[${new Date().toISOString()}] [handlePrompt] ✗ ERROR after ${totalElapsed}ms:`, error);
      // Show error or fallback
      console.log(`[${new Date().toISOString()}] [handlePrompt] Calling overlayManager.showError()...`);
      try {
        this.overlayManager.showError(context, "Failed to optimize. Please try again.");
        console.log(`[${new Date().toISOString()}] [handlePrompt] ✓ overlayManager.showError() completed`);
      } catch (error2) {
        console.error(`[${new Date().toISOString()}] [handlePrompt] ✗ overlayManager.showError() failed:`, error2);
      }
    }
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

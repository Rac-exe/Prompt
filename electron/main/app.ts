import { TriggerDetector } from "./input/trigger-detector";
import { OverlayManager } from "./overlay/overlay-manager";
import { PythonClient } from "./api/python-client";
import { FloatingPanel } from "./overlay/floating-panel";
import { EventEmitter } from "events";
import { globalShortcut } from "electron";

export class PromptOptimizerApp extends EventEmitter {
  private triggerDetector: TriggerDetector;
  private overlayManager: OverlayManager;
  private pythonClient: PythonClient;
  private floatingPanel: FloatingPanel;
  private isInitialized: boolean = false;
  private isPanelVisible: boolean = false;

  constructor() {
    super();
    this.overlayManager = new OverlayManager();
    this.pythonClient = new PythonClient("http://127.0.0.1:8000");
    this.floatingPanel = new FloatingPanel();

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
      // Clear floating panel after successful optimization
      this.floatingPanel.clearPromptText();
    });

    this.triggerDetector.on("optimization-failed", (error: Error) => {
      console.error("[App] Optimization failed:", error);
      this.emit("error", error);
    });

    this.triggerDetector.on("error", (error: Error) => {
      console.error("[App] Trigger detector error:", error);
      this.emit("error", error);
    });

    // Listen to floating panel events
    this.floatingPanel.on("prompt-submit", (promptText: string) => {
      console.log("[App] Prompt submitted from floating panel:", promptText.substring(0, 50));
      // Manually trigger optimization via the trigger detector
      this.handleFloatingPanelPrompt(promptText);
    });

    this.floatingPanel.on("voice-start", () => {
      console.log("[App] Voice input started");
    });

    this.floatingPanel.on("voice-stop", (transcript: string) => {
      console.log("[App] Voice input stopped, transcript:", transcript.substring(0, 50));
      // Automatically trigger optimization after voice input
      if (transcript && transcript.trim().length >= 10) {
        this.handleFloatingPanelPrompt(transcript);
      }
    });

    this.floatingPanel.on("voice-error", (error: string) => {
      console.error("[App] Voice input error:", error);
    });
  }

  /**
   * Handle prompt submission from floating panel
   */
  private handleFloatingPanelPrompt(promptText: string) {
    console.log("[App] Processing floating panel prompt:", promptText);
    this.triggerDetector.triggerManualOptimization(promptText);
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

    // Create floating panel but keep it hidden (don't call show())
    // Panel will be shown when user presses Ctrl+5
    try {
      this.floatingPanel.create();
      this.floatingPanel.hide(); // Start hidden
      console.log("Floating panel created (hidden by default)");
    } catch (error) {
      console.error("Failed to create floating panel:", error);
    }

    // Register global hotkey Ctrl+5 to toggle panel
    try {
      const registered = globalShortcut.register('CommandOrControl+5', () => {
        this.togglePanel();
      });

      if (registered) {
        console.log("Global hotkey registered: Ctrl+5 (or Cmd+5 on macOS)");
      } else {
        console.error("Failed to register global hotkey Ctrl+5");
      }
    } catch (error) {
      console.error("Error registering global hotkey:", error);
    }

    this.isInitialized = true;
    console.log("Prompt Optimizer initialized successfully");
    console.log("Press Ctrl+5 (or Cmd+5 on macOS) to show/hide the floating panel");
    this.emit("initialized");
  }

  /**
   * Toggle floating panel visibility
   */
  private togglePanel() {
    if (this.isPanelVisible) {
      this.floatingPanel.hide();
      this.isPanelVisible = false;
      console.log("[App] Floating panel hidden (Ctrl+5)");
    } else {
      this.floatingPanel.show();
      this.isPanelVisible = true;
      console.log("[App] Floating panel shown (Ctrl+5)");
    }
  }


  async shutdown() {
    console.log("Shutting down Prompt Optimizer...");

    try {
      // Unregister global hotkey
      globalShortcut.unregister('CommandOrControl+5');
      console.log("Global hotkey unregistered");

      this.triggerDetector.stop();
      this.overlayManager.cleanup();
      this.floatingPanel.destroy();
      console.log("Shutdown complete");
    } catch (error) {
      console.error("Error during shutdown:", error);
    }
  }
}

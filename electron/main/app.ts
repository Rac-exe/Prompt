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
    this.pythonClient = new PythonClient("http://127.0.0.1:8001");
    this.floatingPanel = new FloatingPanel();

    // Initialize trigger detector with dependencies
    this.triggerDetector = new TriggerDetector(
      this.pythonClient,
      this.overlayManager
    );

    // Pass trigger detector to overlay manager for text replacement coordination
    this.overlayManager.setTriggerDetector(this.triggerDetector);

    this.setupListeners();
  }

  private setupListeners() {
    // NEW WORKFLOW: Listen to text poller directly for @prompt detection
    // When @prompt is detected, show floating panel immediately
    this.triggerDetector.textPoller.on("trigger-found", (data: any) => {
      console.log("[App] @prompt detected - auto-showing floating panel");
      console.log("[App] Cursor position:", data.cursorPosition);
      console.log("[App] Trigger index:", data.triggerIndex);

      // Store window context for later text replacement
      this.storeWindowContextForReplacement(data);

      // Auto-show floating panel and steal focus
      this.showFloatingPanelOnTrigger();
    });

    // Listen to optimization lifecycle events
    this.triggerDetector.on("session-created", (session) => {
      // console.log("[App] Prompt session created:", session.promptText.substring(0, 50));
    });

    this.triggerDetector.on("session-stable", (session) => {
      // console.log("[App] Prompt stabilized, ready to optimize");
    });

    this.triggerDetector.on("optimization-started", (session) => {
      // console.log("[App] Optimization started");
    });

    this.triggerDetector.on("optimization-completed", (session) => {
      console.log("[App] Optimization completed successfully");
      console.log("[App] Optimized text length:", session.lastOptimized?.length || 0);

      // NEW: Send optimization result to floating panel renderer
      const panelWindow = this.floatingPanel.getWindow();
      if (panelWindow && !panelWindow.isDestroyed()) {
        console.log("[App] Panel window exists, webContents ready:", !panelWindow.webContents.isLoading());

        // Wait for webContents to be ready before sending
        if (panelWindow.webContents.isLoading()) {
          panelWindow.webContents.once('did-finish-load', () => {
            panelWindow.webContents.send("optimization-complete", {
              optimized: session.lastOptimized || "",
              original: session.promptText || ""
            });
            console.log("[App] Sent optimization result to renderer (after load)");
          });
        } else {
          panelWindow.webContents.send("optimization-complete", {
            optimized: session.lastOptimized || "",
            original: session.promptText || ""
          });
          console.log("[App] Sent optimization result to renderer");
        }
      } else {
        console.error("[App] Panel window not available!");
      }
    });

    // Listen to text replacement events
    this.overlayManager.on("text-replaced", () => {
      console.log("[App] Text replaced, clearing text buffer to prevent stale detections");
      this.triggerDetector.clearTextBuffer();
    });

    // Listen to popup dismissal (user clicked outside or pressed ESC)
    this.overlayManager.on("popup-dismissed", (promptText: string) => {
      console.log("[App] Popup dismissed by user - preventing re-optimization of:", promptText.substring(0, 50));
      // Don't need to do anything special - the session is already in SHOWING phase
      // and won't re-optimize unless the text changes
    });

    // Listen to re-optimize requests (refresh button)
    this.overlayManager.on("re-optimize-requested", (originalText: string) => {
      console.log("[App] Re-optimization requested via refresh button:", originalText.substring(0, 50));
      // Force bypass guardrails for refresh (user explicitly wants a new optimization)
      this.triggerDetector.triggerManualOptimization(originalText, true);
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
    this.floatingPanel.on("prompt-submit", (data: string | { text: string; isRegenerate?: boolean }) => {
      const promptText = typeof data === 'string' ? data : data.text;
      const isRegenerate = typeof data === 'string' ? false : !!data.isRegenerate;
      
      console.log("[App] Prompt submitted from floating panel:", promptText.substring(0, 50), isRegenerate ? "(Regenerate)" : "");
      // Manually trigger optimization via the trigger detector
      this.handleFloatingPanelPrompt(promptText, isRegenerate);
    });

    this.floatingPanel.on("voice-start", () => {
      console.log("[App] Voice input started");
    });

    this.floatingPanel.on("voice-stop", (transcript: string) => {
      console.log("[App] Voice input stopped, transcript:", transcript.substring(0, 50));
      // Automatically trigger optimization after voice input
      if (transcript && transcript.trim().length >= 10) {
        this.handleFloatingPanelPrompt(transcript, false);
      }
    });

    this.floatingPanel.on("voice-error", (error: string) => {
      console.error("[App] Voice input error:", error);
    });

    // NEW: Listen to Replace button click from floating panel
    this.floatingPanel.on("replace-requested", (optimizedText: string) => {
      console.log("[App] Replace requested from floating panel");
      this.handleTextReplacementFromPanel(optimizedText);
    });

    // NEW: Listen to panel dismissal (click outside or ESC)
    this.floatingPanel.on("panel-dismissed", () => {
      console.log("[App] Floating panel dismissed - clearing stored context");
      this.storedWindowContext = null; // Clear stored context
      this.isPanelVisible = false;

      // RESTART keyboard monitoring
      console.log("[App] Restarting keyboard monitoring");
      this.triggerDetector.textPoller.start();
    });
  }

  /**
   * NEW: Store window context when @prompt is detected for later replacement
   */
  private storedWindowContext: {
    triggerIndex: number;
    cursorPosition: number;
    windowHandle: string;
    instanceHash: string;
  } | null = null;

  private async storeWindowContextForReplacement(data: any) {
    try {
      const windowContext = await this.triggerDetector.windowTracker.getActiveWindow();

      this.storedWindowContext = {
        triggerIndex: data.triggerIndex,
        cursorPosition: data.cursorPosition,
        windowHandle: windowContext.handle,
        instanceHash: data.instanceHash
      };

      console.log("[App] Stored window context for replacement:", this.storedWindowContext);
    } catch (error) {
      console.error("[App] Failed to store window context:", error);
    }
  }

  /**
   * NEW: Auto-show floating panel when @prompt is detected
   */
  private showFloatingPanelOnTrigger() {
    if (!this.isPanelVisible) {
      console.log("[App] === SHOWING FLOATING PANEL ON @PROMPT DETECTION ===");

      // STOP keyboard monitoring so typing goes to overlay, not ChatGPT
      console.log("[App] Pausing keyboard monitoring");
      this.triggerDetector.textPoller.stop();

      // Use the new method that handles show + expand + focus in one go
      this.floatingPanel.showAndFocusInput();
      this.isPanelVisible = true;

      console.log("[App] Panel shown and input focused");
    } else {
      console.log("[App] Panel already visible, just focusing input");
      // Panel is visible, just focus the input
      const panelWindow = this.floatingPanel.getWindow();
      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.focus();
        panelWindow.webContents.send("focus-input");
      }
    }
  }

  /**
   * Handle prompt submission from floating panel
   * NEW WORKFLOW: Trigger optimization, then replace @prompt with optimized text
   */
  private async handleFloatingPanelPrompt(promptText: string, isRegenerate: boolean = false) {
    console.log("[App] Processing floating panel prompt:", promptText, isRegenerate ? "(Regenerate)" : "");

    // Trigger optimization
    await this.triggerDetector.triggerManualOptimization(promptText, isRegenerate);

    // Wait for optimization to complete (listen to optimization-completed event)
    // The optimization result will be available after this event fires
  }

  /**
   * NEW: Handle text replacement after optimization completes
   * This is called when user clicks "Replace" button in the floating panel
   */
  async handleTextReplacementFromPanel(optimizedText: string) {
    console.log("[App] Handling text replacement from panel");
    console.log("[App] Optimized text:", optimizedText.substring(0, 100));

    if (!this.storedWindowContext) {
      console.error("[App] No stored window context - cannot replace");
      return;
    }

    try {
      // Hide the floating panel first
      this.floatingPanel.hide();
      this.isPanelVisible = false;

      // Restore focus to original window
      console.log("[App] Restoring focus to original window...");
      await this.triggerDetector.windowTracker.restoreFocusToWindowByHandle(this.storedWindowContext.windowHandle);

      // Wait for focus to settle
      await new Promise(resolve => setTimeout(resolve, 150));

      // Perform text replacement:
      // 1. Delete 7 characters (the "@prompt" text)
      // 2. Paste optimized text at that position
      console.log("[App] Replacing @prompt with optimized text...");
      await this.overlayManager.textReplacer.replacePromptMarkerWithText(
        this.storedWindowContext.cursorPosition,
        optimizedText
      );

      // Clear stored context
      this.storedWindowContext = null;

      // Clear text buffer to prevent re-detection
      this.triggerDetector.clearTextBuffer();

      // RESTART keyboard monitoring after replacement
      console.log("[App] Restarting keyboard monitoring after replacement");
      this.triggerDetector.textPoller.start();

      console.log("[App] Text replacement completed successfully");
    } catch (error) {
      console.error("[App] Text replacement failed:", error);
      // RESTART keyboard monitoring even on error
      console.log("[App] Restarting keyboard monitoring after error");
      this.triggerDetector.textPoller.start();
      // Show error to user
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

    // Create floating panel and show it immediately (orb mode)
    try {
      this.floatingPanel.create();
      this.floatingPanel.show(); // Show the orb immediately
      this.isPanelVisible = true; // Mark as visible
      console.log("Floating panel created and shown (orb mode)");
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
   * Toggle floating panel expanded state
   */
  private togglePanel() {
    const panelWindow = this.floatingPanel.getWindow();
    if (panelWindow && !panelWindow.isDestroyed()) {
      console.log("[App] Toggling panel state via Ctrl+5");
      panelWindow.webContents.send("toggle-state");
    } else {
      console.log("[App] Recreating panel window");
      this.floatingPanel.create();
      this.floatingPanel.show();
      this.isPanelVisible = true;
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

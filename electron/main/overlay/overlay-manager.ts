import { BrowserWindow, screen, ipcMain, app } from "electron";
import { PromptContext } from "../input/trigger-detector";
import { TextReplacer } from "../text/text-replacer";
import { WindowTracker, WindowContext } from "../context/window-tracker";
import { EventEmitter } from "events";
import * as path from "path";

interface HighlightOptions {
  loading?: boolean;
}

export class OverlayManager extends EventEmitter {
  private highlights: Map<string, BrowserWindow> = new Map();
  private popups: Map<string, BrowserWindow> = new Map();
  public textReplacer: TextReplacer; // Made public for access from app.ts
  private promptContexts: Map<string, { context: PromptContext; optimized: string; targetWindow: WindowContext }> = new Map();
  private rendererPath: string;
  private activePopupKey: string | null = null; // Track currently active popup
  private dismissCheckInterval: NodeJS.Timeout | null = null; // Timer to check for dismiss conditions
  private triggerDetector: any = null; // Will be set after construction to avoid circular dependency
  private windowTracker: WindowTracker; // Track window focus for UI Automation
  private isDragging: boolean = false;
  private dragStartPosition: { x: number; y: number } = { x: 0, y: 0 };
  private draggedPopup: BrowserWindow | null = null;
  private draggedPopupInitialBounds: { x: number; y: number; width: number; height: number } | null = null;

  constructor() {
    super();
    this.textReplacer = new TextReplacer();
    this.windowTracker = new WindowTracker();
    this.setupIPC();
    // Get the app path and construct renderer directory path
    const appPath = app.getAppPath();
    this.rendererPath = path.join(appPath, "electron", "renderer");
  }

  /**
   * Set trigger detector reference (called after construction to avoid circular dependency)
   */
  setTriggerDetector(triggerDetector: any) {
    this.triggerDetector = triggerDetector;
  }

  private setupIPC() {
    // Handle replace text requests from renderer (old method - just copies to clipboard)
    ipcMain.on("replace-text", async (event, data: { contextKey: string; text: string }) => {
      const promptData = this.promptContexts.get(data.contextKey);
      if (promptData) {
        try {
          await this.handleReplace(promptData.context, data.text);
          this.hide(promptData.context);
        } catch (error) {
          console.error("Failed to replace text:", error);
          this.showError(promptData.context, "Failed to replace text. Please try manually.");
        }
      }
    });

    // Handle replace text in place requests from renderer (new method - actually replaces text)
    ipcMain.on("replace-text-in-place", async (event, data: { contextKey: string; originalText: string; newText: string }) => {
      const promptData = this.promptContexts.get(data.contextKey);
      if (promptData) {
        try {
          console.log("[OverlayManager] Replacing text in place...");
          console.log("[OverlayManager] Original:", data.originalText.substring(0, 100));
          console.log("[OverlayManager] New:", data.newText.substring(0, 100));

          // CRITICAL: Signal text replacement start to prevent paste detection loop
          if (this.triggerDetector) {
            this.triggerDetector.startReplacingText();
          }

          // CRITICAL: Restore focus to target window BEFORE UI Automation
          // This ensures UI Automation targets the correct window (Notepad, etc.)
          console.log("[OverlayManager] Restoring focus to target window for UI Automation...");
          await this.windowTracker.restoreFocusToWindow(promptData.targetWindow);

          // Now perform UI Automation on the focused window
          await this.textReplacer.replaceTextInPlace(data.originalText, data.newText);

          // CRITICAL: Signal text replacement complete and clear buffer immediately
          if (this.triggerDetector) {
            this.triggerDetector.stopReplacingText();
            // Clear buffer immediately to prevent text concatenation
            this.triggerDetector.clearTextBuffer();
          }

          // Close the popup after successful replacement
          this.hide(promptData.context);
          console.log("[OverlayManager] Text replaced successfully");

          // Emit event for any other listeners
          this.emit("text-replaced");
        } catch (error) {
          // CRITICAL: Clear replacement flag and buffer on error too
          if (this.triggerDetector) {
            this.triggerDetector.stopReplacingText();
            this.triggerDetector.clearTextBuffer();
          }

          console.error("Failed to replace text:", error);
          const errorMsg = (error as Error).message || "Unknown error";
          if (errorMsg.includes("UI Automation not available")) {
            this.showError(promptData.context, "Auto-replace not available. Use the Copy button and paste (Ctrl+V).");
          } else {
            this.showError(promptData.context, "Failed to replace text. Please use Copy button instead.");
          }
        }
      }
    });

    // Handle dismiss requests
    ipcMain.on("dismiss-overlay", (event, contextKey: string) => {
      const promptData = this.promptContexts.get(contextKey);
      if (promptData) {
        this.hide(promptData.context);
      }
    });

    // Handle copy to clipboard requests (works without window focus)
    ipcMain.on("copy-to-clipboard", async (event, text: string) => {
      try {
        await this.textReplacer.copyToClipboard(text);
        console.log("[OverlayManager] Text copied to clipboard successfully");
      } catch (error) {
        console.error("[OverlayManager] Failed to copy to clipboard:", error);
      }
    });

    // Handle dismiss requests (popup closed by user clicking outside or ESC)
    ipcMain.on("dismiss-popup", (event, data: { contextKey: string }) => {
      const promptData = this.promptContexts.get(data.contextKey);
      if (promptData) {
        console.log("[OverlayManager] Popup dismissed by user");
        this.hide(promptData.context);
        // Emit event to notify that user dismissed the popup
        // This prevents re-optimization of the same prompt
        this.emit("popup-dismissed", promptData.context.promptText);
      }
    });

    // Handle re-optimize requests (refresh button)
    ipcMain.on("re-optimize", (event, data: { contextKey: string; originalText: string }) => {
      const promptData = this.promptContexts.get(data.contextKey);
      if (promptData) {
        console.log("[OverlayManager] Re-optimization requested for:", data.originalText.substring(0, 50));
        // Hide current overlay
        this.hide(promptData.context);
        // Emit event to trigger re-optimization
        this.emit("re-optimize-requested", data.originalText);
      }
    });

    // Handle popup drag events
    ipcMain.on("popup:drag-start", (event, data: { contextKey: string; x: number; y: number }) => {
      const promptData = this.promptContexts.get(data.contextKey);
      if (promptData && this.popups.has(data.contextKey)) {
        this.isDragging = true;
        this.dragStartPosition = data;
        this.draggedPopup = this.popups.get(data.contextKey)!;
        this.draggedPopupInitialBounds = this.draggedPopup.getBounds();
        console.log("[OverlayManager] Popup drag started for context:", data.contextKey);
      }
    });

    ipcMain.on("popup:drag-move", (event, data: { contextKey: string; x: number; y: number }) => {
      if (!this.isDragging || !this.draggedPopup || !this.draggedPopupInitialBounds) return;

      // Calculate new position based on initial bounds + mouse delta
      const deltaX = data.x - this.dragStartPosition.x;
      const deltaY = data.y - this.dragStartPosition.y;

      let screenX = this.draggedPopupInitialBounds.x + deltaX;
      let screenY = this.draggedPopupInitialBounds.y + deltaY;

      // Get screen bounds to prevent going off-screen
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

      // Constrain to screen bounds (allow some margin for taskbar, etc.)
      const minX = 0;
      const minY = 0;
      const maxX = screenWidth - this.draggedPopupInitialBounds.width;
      const maxY = screenHeight - this.draggedPopupInitialBounds.height;

      screenX = Math.max(minX, Math.min(screenX, maxX));
      screenY = Math.max(minY, Math.min(screenY, maxY));

      // Move window smoothly (no bounds checking during move for performance)
      this.draggedPopup.setPosition(screenX, screenY);
    });

    ipcMain.on("popup:drag-end", (event, data: { contextKey: string; x: number; y: number }) => {
      if (!this.isDragging || !this.draggedPopup || !this.draggedPopupInitialBounds) return;

      // Calculate final position based on initial bounds + mouse delta
      const deltaX = data.x - this.dragStartPosition.x;
      const deltaY = data.y - this.dragStartPosition.y;

      let screenX = this.draggedPopupInitialBounds.x + deltaX;
      let screenY = this.draggedPopupInitialBounds.y + deltaY;

      // Get screen bounds to prevent going off-screen
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

      // Constrain to screen bounds
      const minX = 0;
      const minY = 0;
      const maxX = screenWidth - this.draggedPopupInitialBounds.width;
      const maxY = screenHeight - this.draggedPopupInitialBounds.height;

      screenX = Math.max(minX, Math.min(screenX, maxX));
      screenY = Math.max(minY, Math.min(screenY, maxY));

      // Set final position
      this.draggedPopup.setPosition(screenX, screenY);

      // Reset drag state
      this.isDragging = false;
      this.draggedPopup = null;
      this.draggedPopupInitialBounds = null;
      console.log("[OverlayManager] Popup drag ended for context:", data.contextKey);
    });
  }

  showHighlight(context: PromptContext, options: HighlightOptions = {}) {
    const key = this.getContextKey(context);

    // Remove existing highlight if any
    this.hideHighlight(context);

    const highlight = new BrowserWindow({
      width: 300,
      height: 30,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(app.getAppPath(), "dist", "preload.js")
      }
    });

    // Ensure window is visible
    highlight.show();
    highlight.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    highlight.setAlwaysOnTop(true, 'screen-saver');

    // Position over the prompt text
    const { x, y } = this.calculateHighlightPosition(context);
    // Validate coordinates to prevent NaN errors
    const posX = isNaN(x) || !isFinite(x) ? 100 : Math.max(0, x);
    const posY = isNaN(y) || !isFinite(y) ? 100 : Math.max(0, y);
    highlight.setPosition(posX, posY);

    const htmlPath = path.join(this.rendererPath, "highlight.html");
    highlight.loadFile(htmlPath, { query: options.loading ? { loading: "true" } : {} });

    // Listen for errors only
    highlight.webContents.once("did-fail-load", (event, errorCode, errorDescription) => {
      console.error(`[OverlayManager] Highlight load failed: ${errorCode} - ${errorDescription}`);
    });

    this.highlights.set(key, highlight);
  }

  async showOptimization(
    context: PromptContext,
    original: string,
    optimized: string
  ) {
    const key = this.getContextKey(context);

    // CRITICAL: Capture the currently focused window BEFORE showing popup
    // This is the window we'll restore focus to before UI Automation
    let targetWindow: WindowContext;
    try {
      targetWindow = await this.windowTracker.getActiveWindow();
      console.log(`[OverlayManager] Captured target window: ${targetWindow.processName} - "${targetWindow.title}"`);
    } catch (error) {
      console.error("[OverlayManager] Failed to capture target window:", error);
      // Use context.window as fallback
      targetWindow = {
        handle: context.window.handle,
        title: context.window.title || "Unknown",
        bounds: context.window.bounds || { x: 0, y: 0, width: 800, height: 600 },
        processName: "unknown"
      };
    }

    // Update highlight to show it's ready
    const highlight = this.highlights.get(key);
    if (highlight && !highlight.isDestroyed()) {
      highlight.webContents.send("update-state", { ready: true });
    }

    // Create popup
    const popup = new BrowserWindow({
      width: 600,
      height: 450,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      focusable: true, // Changed to true to enable click-outside detection via blur event
      // Note: This means popup will briefly steal focus from underlying app (like Notepad)
      // However, text replacement happens before popup is shown, so this is safe
      show: false, // Don't show immediately
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(app.getAppPath(), "dist", "preload.js")
      }
    });

    // Position first, then show
    const { x, y } = this.calculatePopupPosition(context);
    // Validate coordinates to prevent NaN errors
    const posX = isNaN(x) || !isFinite(x) ? 100 : Math.max(0, x);
    const posY = isNaN(y) || !isFinite(y) ? 100 : Math.max(0, y);
    popup.setPosition(posX, posY);

    // Ensure window is visible and focused for click-outside detection
    popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    popup.setAlwaysOnTop(true, 'screen-saver');
    popup.show();
    popup.focus(); // Give focus to enable blur event on click-outside

    const queryParams: Record<string, string> = {
      original: original.substring(0, 200), // Limit length
      optimized: optimized.substring(0, 1000)
    };

    const popupHtmlPath = path.join(this.rendererPath, "popup.html");
    popup.loadFile(popupHtmlPath, {
      query: queryParams
    });

    // Store context for IPC handlers (including target window for focus restoration)
    this.promptContexts.set(key, { context, optimized, targetWindow });

    // Expose context key to renderer via preload
    popup.webContents.once("did-finish-load", () => {
      popup.webContents.send("set-context-key", key);
    });

    popup.webContents.once("did-fail-load", (event, errorCode, errorDescription) => {
      console.error(`[OverlayManager] Popup load failed: ${errorCode} - ${errorDescription}`);
    });

    // Track active popup
    this.activePopupKey = key;

    // Start monitoring for dismiss conditions (Grammarly pattern: non-intrusive monitoring)
    // Check periodically if popup should be dismissed
    this.startDismissMonitoring(popup, context, key);

    // Cleanup when popup is closed
    popup.on('closed', () => {
      if (this.activePopupKey === key) {
        this.activePopupKey = null;
      }
      this.stopDismissMonitoring();
    });

    this.popups.set(key, popup);
  }

  showError(context: PromptContext, message: string) {
    const key = this.getContextKey(context);

    // Hide highlight
    this.hideHighlight(context);

    // Show error popup
    const errorPopup = new BrowserWindow({
      width: 400,
      height: 150,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const { x, y } = this.calculatePopupPosition(context);
    errorPopup.setPosition(Math.max(0, x), Math.max(0, y));

    const errorQuery: Record<string, string> = { message };
    errorPopup.loadFile(path.join(this.rendererPath, "error.html"), {
      query: errorQuery
    });

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      if (!errorPopup.isDestroyed()) {
        errorPopup.close();
      }
    }, 3000);
  }

  private calculateHighlightPosition(context: PromptContext): { x: number; y: number } {
    // Simplified - in reality, need better cursor position estimation
    // For now, position near the estimated cursor
    // Validate bounds exist and are valid numbers
    const boundsX = context.window?.bounds?.x ?? 0;
    const boundsY = context.window?.bounds?.y ?? 0;
    const estimatedX = (isNaN(context.estimatedCursorX) ? boundsX + 50 : context.estimatedCursorX);
    const estimatedY = (isNaN(context.estimatedCursorY) ? boundsY + 100 : context.estimatedCursorY);

    return {
      x: estimatedX,
      y: estimatedY - 25
    };
  }

  private calculatePopupPosition(context: PromptContext): { x: number; y: number } {
    // Position popup above the highlight, or below if not enough space
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const popupWidth = 550;
    const popupHeight = 350;

    let x = context.estimatedCursorX;
    let y = context.estimatedCursorY - popupHeight - 10;

    // Adjust if popup would go off screen
    if (y < 0) {
      y = context.estimatedCursorY + 30; // Show below instead
    }
    if (x + popupWidth > screenWidth) {
      x = screenWidth - popupWidth - 10;
    }
    if (x < 0) {
      x = 10;
    }

    // Ensure we don't overlap the top edge area where the floating Ctrl+5 bar lives
    const MIN_TOP_MARGIN = 80;
    if (y < MIN_TOP_MARGIN) {
      y = MIN_TOP_MARGIN;
    }

    return { x, y };
  }

  /**
   * Start monitoring for popup dismiss conditions (Grammarly pattern)
   * Uses ESC key detection + click-outside detection via blur event
   */
  private startDismissMonitoring(popup: BrowserWindow, context: PromptContext, key: string) {
    // Stop any existing monitoring
    this.stopDismissMonitoring();

    // Listen for blur event - fires when user clicks outside the popup window
    const onBlur = () => {
      if (popup.isDestroyed()) return;

      console.log("[OverlayManager] Popup lost focus (clicked outside), dismissing...");
      this.hide(context);
    };

    // Store the listener so we can remove it later
    popup.once('blur', onBlur);

    // Also keep a periodic check for edge cases
    this.dismissCheckInterval = setInterval(() => {
      if (popup.isDestroyed()) {
        this.stopDismissMonitoring();
        return;
      }

      // If popup loses focus for any reason, dismiss it
      if (!popup.isFocused()) {
        console.log("[OverlayManager] Popup not focused, dismissing...");
        this.hide(context);
      }
    }, 500); // Check every 500ms as fallback
  }

  /**
   * Stop dismiss monitoring
   */
  private stopDismissMonitoring() {
    if (this.dismissCheckInterval) {
      clearInterval(this.dismissCheckInterval);
      this.dismissCheckInterval = null;
    }
  }

  private getContextKey(context: PromptContext): string {
    return `${context.window.handle}-${context.timestamp}`;
  }

  private async handleReplace(context: PromptContext, newText: string) {
    try {
      // For MVP: Copy to clipboard and show instruction
      // In production, implement actual keyboard simulation
      await this.textReplacer.copyToClipboard(newText);

      // Try to simulate paste (this is a placeholder - needs native module)
      console.log("Text copied to clipboard. Simulating paste...");
      console.log("Note: Full keyboard simulation requires native module");

      // TODO: Implement actual keyboard simulation
      // For now, user can manually paste (Ctrl+V / Cmd+V)

    } catch (error) {
      console.error("Text replacement error:", error);
      throw error;
    }
  }

  hide(context: PromptContext) {
    const key = this.getContextKey(context);
    this.hideHighlight(context);
    this.hidePopup(context);
    this.promptContexts.delete(key);
  }

  private hideHighlight(context: PromptContext) {
    const key = this.getContextKey(context);
    const highlight = this.highlights.get(key);
    if (highlight && !highlight.isDestroyed()) {
      highlight.close();
    }
    this.highlights.delete(key);
  }

  private hidePopup(context: PromptContext) {
    const key = this.getContextKey(context);
    const popup = this.popups.get(key);
    if (popup && !popup.isDestroyed()) {
      popup.close();
    }
    this.popups.delete(key);
  }

  cleanup() {
    this.highlights.forEach(win => {
      if (!win.isDestroyed()) {
        win.close();
      }
    });
    this.popups.forEach(win => {
      if (!win.isDestroyed()) {
        win.close();
      }
    });
    this.highlights.clear();
    this.popups.clear();
    this.promptContexts.clear();
  }
}

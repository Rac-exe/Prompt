import { BrowserWindow, screen, ipcMain, app } from "electron";
import { PromptContext } from "../input/trigger-detector";
import { TextReplacer } from "../text/text-replacer";
import { EventEmitter } from "events";
import * as path from "path";

interface HighlightOptions {
  loading?: boolean;
}

export class OverlayManager extends EventEmitter {
  private highlights: Map<string, BrowserWindow> = new Map();
  private popups: Map<string, BrowserWindow> = new Map();
  private textReplacer: TextReplacer;
  private promptContexts: Map<string, { context: PromptContext; optimized: string }> = new Map();
  private rendererPath: string;

  constructor() {
    super();
    this.textReplacer = new TextReplacer();
    this.setupIPC();
    // Get the app path and construct renderer directory path
    const appPath = app.getAppPath();
    this.rendererPath = path.join(appPath, "electron", "renderer");
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

          await this.textReplacer.replaceTextInPlace(data.originalText, data.newText);

          // Close the popup after successful replacement
          this.hide(promptData.context);
          console.log("[OverlayManager] Text replaced successfully");

          // Emit event to clear text buffer and prevent stale detections
          this.emit("text-replaced");
        } catch (error) {
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

  showOptimization(
    context: PromptContext,
    original: string,
    optimized: string
  ) {
    const key = this.getContextKey(context);

    // Update highlight to show it's ready
    const highlight = this.highlights.get(key);
    if (highlight && !highlight.isDestroyed()) {
      highlight.webContents.send("update-state", { ready: true });
    }

    // Create popup
    const popup = new BrowserWindow({
      width: 550,
      height: 350,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false, // Keep underlying window (Notepad) focused for UI Automation
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(app.getAppPath(), "dist", "preload.js")
      }
    });

    // Ensure window is visible
    popup.show();
    popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    popup.setAlwaysOnTop(true, 'screen-saver');

    const { x, y } = this.calculatePopupPosition(context);
    // Validate coordinates to prevent NaN errors
    const posX = isNaN(x) || !isFinite(x) ? 100 : Math.max(0, x);
    const posY = isNaN(y) || !isFinite(y) ? 100 : Math.max(0, y);
    popup.setPosition(posX, posY);

    const queryParams: Record<string, string> = {
      original: original.substring(0, 200), // Limit length
      optimized: optimized.substring(0, 1000)
    };

    const popupHtmlPath = path.join(this.rendererPath, "popup.html");
    popup.loadFile(popupHtmlPath, {
      query: queryParams
    });

    // Store context for IPC handlers
    this.promptContexts.set(key, { context, optimized });

    // Expose context key to renderer via preload
    popup.webContents.once("did-finish-load", () => {
      popup.webContents.send("set-context-key", key);
    });

    popup.webContents.once("did-fail-load", (event, errorCode, errorDescription) => {
      console.error(`[OverlayManager] Popup load failed: ${errorCode} - ${errorDescription}`);
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

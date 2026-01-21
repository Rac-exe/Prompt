import { BrowserWindow, ipcMain, app } from "electron";
import * as path from "path";
import { SnapPositionCalculator, SnapPosition, ScreenCoordinates } from "./snap-positions";
import { EventEmitter } from "events";
import WebSocket from "ws";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Floating overlay panel with snap-to-position dragging and voice input
 */
export class FloatingPanel extends EventEmitter {
  private window: BrowserWindow | null = null;
  private snapCalculator: SnapPositionCalculator;
  private currentPosition: SnapPosition = SnapPosition.TOP_CENTER;
  private isDragging: boolean = false;
  private dragStartPosition: ScreenCoordinates = { x: 0, y: 0 };
  private transcriptionWebSocket: WebSocket | null = null;
  private isTranscribing: boolean = false;
  private sessionId: string | null = null;
  private collapsedPosition: { x: number; y: number } | null = null; // Remember orb position

  constructor() {
    super();
    this.snapCalculator = new SnapPositionCalculator();
    this.setupIPC();
  }

  /**
   * Create and show the floating panel
   */
  create() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      return;
    }

    const { width, height } = this.snapCalculator.getDimensions();
    const position = this.snapCalculator.getPosition(this.currentPosition);

    this.window = new BrowserWindow({
      width,
      height,
      x: position.x,
      y: position.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true, // Hide from taskbar (stay invisible like emoji picker)
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      focusable: true,
      hasShadow: false, // No shadow to be more subtle
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(app.getAppPath(), "dist", "preload.js")
      }
    });

    // Load the floating panel HTML (v3 with new design)
    const htmlPath = path.join(app.getAppPath(), "electron", "renderer", "floating-panel-v3.html");
    this.window.loadFile(htmlPath);

    // Show when ready
    this.window.once("ready-to-show", () => {
      if (this.window) {
        this.window.show();
        this.window.setAlwaysOnTop(true, "screen-saver");
        this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

        // Make window click-through EXCEPT for the panel area
        // This allows ChatGPT to remain clickable behind it
        this.window.setIgnoreMouseEvents(true, { forward: true });

        console.log("[FloatingPanel] Shown at position:", this.currentPosition);
      }
    });

    // Handle window close
    this.window.on("closed", () => {
      this.window = null;
    });

    console.log("[FloatingPanel] Created at position:", this.currentPosition);
  }

  /**
   * Setup IPC handlers for renderer communication
   */
  private setupIPC() {
    // Start drag
    ipcMain.on("floating-panel:drag-start", (event, data: { x: number; y: number }) => {
      this.isDragging = true;
      this.dragStartPosition = data;
      console.log("[FloatingPanel] Drag started");
    });

    // During drag - move window freely (no snapping)
    ipcMain.on("floating-panel:drag-move", (event, data: { x: number; y: number }) => {
      if (!this.isDragging || !this.window) return;

      // Calculate cursor position in screen coordinates
      const bounds = this.window.getBounds();
      const screenX = bounds.x + data.x - this.dragStartPosition.x;
      const screenY = bounds.y + data.y - this.dragStartPosition.y;

      // Move window to follow cursor freely
      this.window.setPosition(screenX, screenY);
    });

    // End drag - keep window at current position (no snapping)
    ipcMain.on("floating-panel:drag-end", (event, data: { x: number; y: number }) => {
      if (!this.isDragging || !this.window) return;

      // Calculate final position
      const bounds = this.window.getBounds();
      const screenX = bounds.x + data.x - this.dragStartPosition.x;
      const screenY = bounds.y + data.y - this.dragStartPosition.y;

      // Set final position (no snapping)
      this.window.setPosition(screenX, screenY);

      this.isDragging = false;
      console.log("[FloatingPanel] Dragged to position:", { x: screenX, y: screenY });
    });

    // Prompt submitted from text box
    ipcMain.on("floating-panel:prompt-submit", (event, promptText: string) => {
      console.log("[FloatingPanel] Prompt submitted:", promptText.substring(0, 50));
      this.emit("prompt-submit", promptText);
    });

    // Voice input started
    ipcMain.on("floating-panel:voice-start", () => {
      console.log("[FloatingPanel] Voice input started");
      this.emit("voice-start");
    });

    // Voice input stopped
    ipcMain.on("floating-panel:voice-stop", (event, transcript: string) => {
      console.log("[FloatingPanel] Voice input stopped, transcript:", transcript.substring(0, 50));
      this.emit("voice-stop", transcript);
    });

    // Voice input error
    ipcMain.on("floating-panel:voice-error", (event, error: string) => {
      console.error("[FloatingPanel] Voice input error:", error);
      this.emit("voice-error", error);
    });

    // Transcription start
    ipcMain.on("floating-panel:transcription-start", () => {
      this.startTranscription();
    });

    // Transcription stop
    ipcMain.on("floating-panel:transcription-stop", () => {
      this.stopTranscription();
    });

    // Set prompt text
    ipcMain.on("floating-panel:set-prompt-text", (event, text: string) => {
      this.setPromptText(text);
    });

    // Window resize handler
    ipcMain.on("floating-panel:resize", (event, data: { width: number; height: number }) => {
      this.resizeWindow(data.width, data.height);
    });

    // Smart resize and reposition handler (prevents going off-screen)
    ipcMain.on("floating-panel:resize-and-reposition", (event, data: { width: number; height: number; fromState: string }) => {
      this.resizeAndReposition(data.width, data.height, data.fromState);
    });

    // NEW: Handle Replace button click (optimized text ready to replace @prompt)
    ipcMain.on("floating-panel:replace-text", (event, data: { optimizedText: string }) => {
      console.log("[FloatingPanel] Replace requested with optimized text:", data.optimizedText.substring(0, 50));
      this.emit("replace-requested", data.optimizedText);
    });

    // NEW: Handle panel dismissal (click outside or ESC key)
    ipcMain.on("floating-panel:dismiss", () => {
      console.log("[FloatingPanel] Panel dismissed by user");
      this.emit("panel-dismissed");
      this.hide();
    });

    // Handle mouse enter/leave for click-through behavior
    ipcMain.on("floating-panel:set-clickable", (event, clickable: boolean) => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.setIgnoreMouseEvents(!clickable, { forward: true });
      }
    });
  }

  /**
   * Force focus using Windows API (for Windows only)
   */
  private async forceWindowsFocus() {
    if (process.platform !== 'win32' || !this.window) return;

    try {
      const hwnd = this.window.getNativeWindowHandle();
      const handle = '0x' + hwnd.readUInt32LE(0).toString(16);

      console.log('[FloatingPanel] Using Windows API to force focus, handle:', handle);

      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetFocus(IntPtr hWnd);
}
"@

$handle = [IntPtr]::new(${handle})
[Win32]::ShowWindow($handle, 5)      # SW_SHOW
[Win32]::BringWindowToTop($handle)   # Bring to top
[Win32]::SetForegroundWindow($handle) # Set as foreground
[Win32]::SetFocus($handle)           # Set keyboard focus
Write-Host "SUCCESS"
`;

      await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
      console.log('[FloatingPanel] Windows API focus applied successfully');
    } catch (error) {
      console.error('[FloatingPanel] Failed to force focus via Windows API:', error);
    }
  }

  /**
   * Show the panel - Like Windows emoji picker (no tab switching)
   */
  show() {
    console.log('[FloatingPanel] === SHOW() CALLED ===');
    if (!this.window || this.window.isDestroyed()) {
      console.log('[FloatingPanel] Creating new window');
      this.create();
    } else {
      console.log('[FloatingPanel] Showing panel (no tab switch)');

      // Show + focus but don't require tab switching
      this.window.showInactive(); // Show without stealing focus from ChatGPT
      this.window.setAlwaysOnTop(true, "screen-saver");

      // After a moment, focus it (user can keep typing in ChatGPT or overlay)
      setTimeout(() => {
        this.window?.focus();
      }, 50);

      console.log('[FloatingPanel] - Window shown');
    }
  }

  /**
   * Hide the panel
   */
  hide() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  /**
   * Destroy the panel
   */
  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
  }

  /**
   * Set the prompt text
   */
  setPromptText(text: string) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("set-prompt-text", text);
    }
  }

  /**
   * Clear the prompt text
   */
  clearPromptText() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("clear-prompt-text");
    }
  }

  /**
   * Get current window
   */
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Resize the window
   */
  resizeWindow(width: number, height: number) {
    if (this.window && !this.window.isDestroyed()) {
      const currentBounds = this.window.getBounds();

      // Calculate center position to keep window centered during resize
      const newX = currentBounds.x + (currentBounds.width - width) / 2;
      const newY = currentBounds.y + (currentBounds.height - height) / 2;

      this.window.setBounds({
        x: Math.floor(newX),
        y: Math.floor(newY),
        width,
        height
      }, true); // true = animate

      console.log(`[FloatingPanel] Resized to ${width}x${height}`);
    }
  }

  /**
   * Smart resize and reposition to prevent going off-screen
   * Adjusts position based on current screen location
   */
  resizeAndReposition(width: number, height: number, fromState: string) {
    if (!this.window || this.window.isDestroyed()) return;

    const { screen } = require('electron');
    const currentBounds = this.window.getBounds();
    const display = screen.getDisplayNearestPoint({ x: currentBounds.x, y: currentBounds.y });
    const screenBounds = display.workArea;

    let newX = currentBounds.x;
    let newY = currentBounds.y;

    // When expanding from collapsed to expanded or detailed
    if (fromState === 'collapsed') {
      // Save the collapsed position before expanding
      this.collapsedPosition = { x: currentBounds.x, y: currentBounds.y };
      console.log(`[FloatingPanel] Saved collapsed position: (${currentBounds.x}, ${currentBounds.y})`);

      // Calculate if we're near edges
      const distanceFromLeft = currentBounds.x - screenBounds.x;
      const distanceFromRight = (screenBounds.x + screenBounds.width) - (currentBounds.x + currentBounds.width);
      const distanceFromTop = currentBounds.y - screenBounds.y;
      const distanceFromBottom = (screenBounds.y + screenBounds.height) - (currentBounds.y + currentBounds.height);

      // Horizontal positioning (for expanded state especially)
      if (width > currentBounds.width) {
        // Need to expand horizontally
        const widthDiff = width - currentBounds.width;

        // If near right edge, expand to the left
        if (distanceFromRight < widthDiff / 2) {
          newX = currentBounds.x - widthDiff;
        }
        // If near left edge, expand to the right
        else if (distanceFromLeft < widthDiff / 2) {
          newX = currentBounds.x;
        }
        // Otherwise, expand from center (but check if it fits)
        else {
          newX = currentBounds.x - widthDiff / 2;
        }
      }

      // Vertical positioning
      if (height > currentBounds.height) {
        const heightDiff = height - currentBounds.height;

        // If near bottom edge, expand upward
        if (distanceFromBottom < heightDiff / 2) {
          newY = currentBounds.y - heightDiff;
        }
        // If near top edge, expand downward
        else if (distanceFromTop < heightDiff / 2) {
          newY = currentBounds.y;
        }
        // Otherwise, expand from center
        else {
          newY = currentBounds.y - heightDiff / 2;
        }
      }
    }
    // When collapsing back to orb, restore saved position
    else if ((fromState === 'expanded' || fromState === 'detailed') && width === 96 && height === 96) {
      if (this.collapsedPosition) {
        newX = this.collapsedPosition.x;
        newY = this.collapsedPosition.y;
        console.log(`[FloatingPanel] Restoring collapsed position: (${newX}, ${newY})`);
      } else {
        // Fallback: center on current position
        newX = currentBounds.x + (currentBounds.width - width) / 2;
        newY = currentBounds.y + (currentBounds.height - height) / 2;
      }
    }
    // When transitioning between expanded states, center it
    else {
      newX = currentBounds.x + (currentBounds.width - width) / 2;
      newY = currentBounds.y + (currentBounds.height - height) / 2;
    }

    // Ensure window stays within screen bounds
    newX = Math.max(screenBounds.x, Math.min(newX, screenBounds.x + screenBounds.width - width));
    newY = Math.max(screenBounds.y, Math.min(newY, screenBounds.y + screenBounds.height - height));

    this.window.setBounds({
      x: Math.floor(newX),
      y: Math.floor(newY),
      width,
      height
    }, true); // true = animate

    console.log(`[FloatingPanel] Smart repositioned to ${width}x${height} at (${newX}, ${newY})`);
  }

  /**
   * Start transcription via WebSocket
   */
  private startTranscription() {
    if (this.isTranscribing) {
      console.log("[FloatingPanel] Already transcribing, ignoring start request");
      return;
    }

    // Close any existing connection first
    if (this.transcriptionWebSocket) {
      console.log("[FloatingPanel] Closing existing WebSocket before starting new session");
      try {
        this.transcriptionWebSocket.close();
      } catch (e) {
        console.error("[FloatingPanel] Error closing existing WebSocket:", e);
      }
      this.transcriptionWebSocket = null;
    }

    try {
      this.sessionId = `session_${Date.now()}`;
      const wsUrl = "ws://127.0.0.1:8001/ws/transcribe";

      console.log("[FloatingPanel] Connecting to transcription WebSocket:", wsUrl, "Session:", this.sessionId);

      this.transcriptionWebSocket = new WebSocket(wsUrl);
      const ws = this.transcriptionWebSocket; // Store reference for callbacks

      ws.on("open", () => {
        console.log("[FloatingPanel] WebSocket connected");
        this.isTranscribing = true;

        // Send start message
        if (this.transcriptionWebSocket) {
          this.transcriptionWebSocket.send(JSON.stringify({
            action: "start",
            session_id: this.sessionId
          }));
        }

        // Notify renderer
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send("transcription-update", {
            type: "status",
            status: "listening"
          });
        }
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log("[FloatingPanel] Transcription message:", message.type);
          
          if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send("transcription-update", message);
          }
          
          // Emit events for app.ts listeners
          if (message.type === "transcription") {
            this.emit("transcription-update", message.accumulated);
          } else if (message.type === "final") {
            this.emit("transcription-final", message.text);
          }
        } catch (error) {
          console.error("[FloatingPanel] Failed to parse WebSocket message:", error);
        }
      });
      
      ws.on("error", (error: Error) => {
        console.error("[FloatingPanel] WebSocket error:", error);
        this.isTranscribing = false;

        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send("transcription-update", {
            type: "error",
            message: "Failed to connect to transcription service"
          });
        }
      });

      ws.on("close", () => {
        console.log("[FloatingPanel] WebSocket closed");
        this.isTranscribing = false;
        this.transcriptionWebSocket = null;
        
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send("transcription-update", {
            type: "status",
            status: "stopped"
          });
        }
      });
      
    } catch (error) {
      console.error("[FloatingPanel] Failed to start transcription:", error);
      this.isTranscribing = false;
      
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send("transcription-update", {
          type: "error",
          message: `Failed to start transcription: ${error}`
        });
      }
    }
  }

  /**
   * Stop transcription
   */
  private stopTranscription() {
    if (!this.isTranscribing || !this.transcriptionWebSocket) {
      return;
    }

    try {
      console.log("[FloatingPanel] Stopping transcription - sending stop message");

      // Send stop message
      this.transcriptionWebSocket.send(JSON.stringify({
        action: "stop",
        session_id: this.sessionId
      }));

      // Wait for server to process final transcription before closing (2 seconds delay)
      // This allows the server to finish transcribing and send final results
      console.log("[FloatingPanel] Waiting 2s for final transcription before closing WebSocket...");
      setTimeout(() => {
        if (this.transcriptionWebSocket) {
          console.log("[FloatingPanel] Closing WebSocket after delay");
          this.transcriptionWebSocket.close();
          this.transcriptionWebSocket = null;
        }
        this.isTranscribing = false;
        this.sessionId = null;
      }, 2000); // 2 second delay

    } catch (error) {
      console.error("[FloatingPanel] Error stopping transcription:", error);
    }
  }
}

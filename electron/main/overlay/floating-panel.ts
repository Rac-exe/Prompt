import { BrowserWindow, ipcMain, app } from "electron";
import * as path from "path";
import { SnapPositionCalculator, SnapPosition, ScreenCoordinates } from "./snap-positions";
import { EventEmitter } from "events";
import WebSocket from "ws";

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
      skipTaskbar: true,
      resizable: false,
      movable: false, // We handle movement manually
      minimizable: false,
      maximizable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(app.getAppPath(), "dist", "preload.js")
      }
    });

    // Load the floating panel HTML
    const htmlPath = path.join(app.getAppPath(), "electron", "renderer", "floating-panel.html");
    this.window.loadFile(htmlPath);

    // Show when ready
    this.window.once("ready-to-show", () => {
      if (this.window) {
        this.window.show();
        this.window.setAlwaysOnTop(true, "screen-saver");
        this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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

    // During drag - show preview of snap positions
    ipcMain.on("floating-panel:drag-move", (event, data: { x: number; y: number }) => {
      if (!this.isDragging || !this.window) return;

      // Calculate cursor position in screen coordinates
      const bounds = this.window.getBounds();
      const screenX = bounds.x + data.x - this.dragStartPosition.x;
      const screenY = bounds.y + data.y - this.dragStartPosition.y;

      // Find nearest snap position
      const nearestSnap = this.snapCalculator.findNearestPosition(screenX, screenY);

      // Move window to follow cursor (we'll snap on release)
      this.window.setPosition(screenX, screenY);
    });

    // End drag - snap to nearest position
    ipcMain.on("floating-panel:drag-end", (event, data: { x: number; y: number }) => {
      if (!this.isDragging || !this.window) return;

      // Calculate final position
      const bounds = this.window.getBounds();
      const screenX = bounds.x + data.x - this.dragStartPosition.x;
      const screenY = bounds.y + data.y - this.dragStartPosition.y;

      // Find nearest snap position
      const nearestSnap = this.snapCalculator.findNearestPosition(screenX, screenY);
      const snapCoords = this.snapCalculator.getPosition(nearestSnap);

      // Snap to position with animation
      this.window.setPosition(snapCoords.x, snapCoords.y, true);
      this.currentPosition = nearestSnap;

      this.isDragging = false;
      console.log("[FloatingPanel] Snapped to position:", nearestSnap);
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
  }

  /**
   * Show the panel
   */
  show() {
    if (!this.window || this.window.isDestroyed()) {
      this.create();
    } else {
      this.window.show();
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
   * Start transcription via WebSocket
   */
  private startTranscription() {
    if (this.isTranscribing) {
      console.log("[FloatingPanel] Already transcribing");
      return;
    }

    try {
      this.sessionId = `session_${Date.now()}`;
      const wsUrl = "ws://127.0.0.1:8000/ws/transcribe";
      
      console.log("[FloatingPanel] Connecting to transcription WebSocket:", wsUrl);
      
      this.transcriptionWebSocket = new WebSocket(wsUrl);
      
      this.transcriptionWebSocket.on("open", () => {
        console.log("[FloatingPanel] WebSocket connected");
        this.isTranscribing = true;
        
        // Send start message
        this.transcriptionWebSocket?.send(JSON.stringify({
          action: "start",
          session_id: this.sessionId
        }));
        
        // Notify renderer
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send("transcription-update", {
            type: "status",
            status: "listening"
          });
        }
      });
      
      this.transcriptionWebSocket.on("message", (data: WebSocket.Data) => {
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
      
      this.transcriptionWebSocket.on("error", (error) => {
        console.error("[FloatingPanel] WebSocket error:", error);
        this.isTranscribing = false;
        
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send("transcription-update", {
            type: "error",
            message: "Failed to connect to transcription service"
          });
        }
      });
      
      this.transcriptionWebSocket.on("close", () => {
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
      console.log("[FloatingPanel] Stopping transcription");
      
      this.transcriptionWebSocket.send(JSON.stringify({
        action: "stop",
        session_id: this.sessionId
      }));
      
      this.transcriptionWebSocket.close();
      this.isTranscribing = false;
      this.transcriptionWebSocket = null;
      this.sessionId = null;
      
    } catch (error) {
      console.error("[FloatingPanel] Error stopping transcription:", error);
    }
  }
}

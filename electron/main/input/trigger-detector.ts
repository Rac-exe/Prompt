import { EventEmitter } from "events";
import { KeyboardHook } from "./keyboard-hook";
import { WindowTracker, WindowContext } from "../context/window-tracker";

export interface PromptContext {
  window: WindowContext;
  promptText: string;
  estimatedCursorX: number;
  estimatedCursorY: number;
  timestamp: number;
}

export class TriggerDetector extends EventEmitter {
  private keyboardHook: KeyboardHook;
  private windowTracker: WindowTracker;
  private isCapturingPrompt: boolean = false;
  private captureBuffer: string = "";
  private captureStartTime: number = 0;
  private readonly CAPTURE_TIMEOUT = 10000; // 10 seconds
  private keyListener: ((e: any, down: boolean) => void) | null = null;
  private captureTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.keyboardHook = new KeyboardHook();
    this.windowTracker = new WindowTracker();
    this.setupListeners();
  }

  private setupListeners() {
    this.keyboardHook.on("trigger-detected", () => {
      this.startPromptCapture();
    });

    // Listen for captured prompt text from keyboard hook
    this.keyboardHook.on("prompt-text-captured", (text: string) => {
      this.handleCapturedText(text);
    });
  }

  private handleCapturedText(text: string) {
    if (!this.isCapturingPrompt) {
      return;
    }

    console.log("Received captured text:", text);
    this.captureBuffer = text;
    this.finishCapture();
  }

  private startPromptCapture() {
    if (this.isCapturingPrompt) {
      // Already capturing, finish current capture
      this.finishCapture();
      return;
    }

    this.isCapturingPrompt = true;
    this.captureBuffer = "";
    this.captureStartTime = Date.now();
    
    // Get current window context
    const window = this.windowTracker.getCurrentContext();
    if (!window) {
      console.warn("No window context available");
      this.isCapturingPrompt = false;
      return;
    }

    console.log("Started capturing prompt in:", window.title);
    console.log("Type your prompt and press Enter to finish, or Escape to cancel");
    
    // Set up a timeout in case user doesn't press Enter
    this.captureTimer = setTimeout(() => {
      if (this.isCapturingPrompt) {
        console.log("Capture timeout - waiting for Enter key");
        // Don't cancel, just log - wait for Enter key
      }
    }, 30000); // 30 second timeout
  }

  private finishCapture() {
    const trimmed = this.captureBuffer.trim();
    
    if (trimmed.length === 0) {
      this.cancelCapture();
      return;
    }

    const window = this.windowTracker.getCurrentContext();
    if (!window) {
      this.cancelCapture();
      return;
    }

    // Estimate cursor position (simplified - would need better calculation)
    // Assume text starts at some offset from window edge
    const estimatedCursorX = window.bounds.x + 50;
    const estimatedCursorY = window.bounds.y + 100; // Rough estimate for text field

    const context: PromptContext = {
      window,
      promptText: trimmed,
      estimatedCursorX,
      estimatedCursorY,
      timestamp: Date.now()
    };

    console.log("Prompt captured:", trimmed);
    this.emit("prompt-captured", context);
    this.reset();
  }

  private cancelCapture() {
    console.log("Prompt capture cancelled");
    this.reset();
  }

  private reset() {
    this.isCapturingPrompt = false;
    this.captureBuffer = "";
    this.captureStartTime = 0;
    this.keyListener = null;
    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }
  }

  start() {
    try {
      this.keyboardHook.start();
      this.windowTracker.startTracking();
      console.log("Trigger detector started");
    } catch (error) {
      console.error("Failed to start trigger detector:", error);
      this.emit("error", error);
      throw error;
    }
  }

  stop() {
    this.keyboardHook.stop();
    this.windowTracker.stopTracking();
    this.reset();
  }
}

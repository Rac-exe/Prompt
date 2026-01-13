import { EventEmitter } from "events";
import { GlobalKeyboardListener } from "node-global-key-listener";

/**
 * Text state poller - monitors typed text for @prompt trigger
 * Uses a simulated text buffer built from keystroke events
 */
export class TextStatePoller extends EventEmitter {
  private listener: GlobalKeyboardListener | null = null;
  private textBuffer: string = "";
  private pollingTimer: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 200;
  private readonly MAX_BUFFER_SIZE = 1000;
  private shiftPressed: boolean = false;
  private isRunning: boolean = false;
  private lastEmittedPromptText: string = "";
  private lastEmittedState: "found" | "not-found" | "partial" = "not-found";

  constructor() {
    super();
  }

  /**
   * Start polling for text state changes
   */
  start() {
    if (this.isRunning) {
      return;
    }

    console.log("[TextStatePoller] Starting...");

    // Start keystroke capture
    this.startKeystrokeCapture();

    // Start polling loop
    this.pollingTimer = setInterval(() => {
      this.checkTextState();
    }, this.POLL_INTERVAL_MS);

    this.isRunning = true;
    console.log("[TextStatePoller] Started - polling every", this.POLL_INTERVAL_MS, "ms");
  }

  /**
   * Stop polling
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log("[TextStatePoller] Stopping...");

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    if (this.listener) {
      this.listener.kill();
      this.listener = null;
    }

    this.textBuffer = "";
    this.isRunning = false;
    console.log("[TextStatePoller] Stopped");
  }

  /**
   * Get current text buffer
   */
  getCurrentText(): string {
    return this.textBuffer;
  }

  /**
   * Start capturing keystrokes to build text buffer
   */
  private startKeystrokeCapture() {
    try {
      this.listener = new GlobalKeyboardListener();
      this.setupKeystrokeListener();
      console.log("[TextStatePoller] Keystroke capture started");
    } catch (error) {
      console.error("[TextStatePoller] Failed to start keystroke capture:", error);
      throw error;
    }
  }

  /**
   * Setup keystroke listener to maintain text buffer
   */
  private setupKeystrokeListener() {
    if (!this.listener) {
      return;
    }

    this.listener.addListener((event: any) => {
      const scanCode = event?.scanCode;
      if (!scanCode) return;

      // Track shift state
      if (scanCode === 42 || scanCode === 54 || scanCode === 160) {
        if (event?.state === 'DOWN') {
          this.shiftPressed = true;
        } else if (event?.state === 'UP') {
          this.shiftPressed = false;
        }
        return;
      }

      // Only process keydown events
      if (event?.state !== 'DOWN') return;

      // Convert scan code to character
      let char = this.scanCodeToChar(scanCode);
      if (!char) return;

      // Handle shift-modified keys
      if (this.shiftPressed && (scanCode === 3 || scanCode === 50)) {
        char = '@'; // Shift+2 = @
      } else if (this.shiftPressed && scanCode >= 65 && scanCode <= 90) {
        char = String.fromCharCode(scanCode); // Keep uppercase
      }

      this.updateTextBuffer(char, scanCode);
    });
  }

  /**
   * Convert scan code to character
   */
  private scanCodeToChar(scanCode: number): string | null {
    // Letters A-Z
    if (scanCode >= 65 && scanCode <= 90) {
      return String.fromCharCode(scanCode).toLowerCase();
    }

    // Numbers
    const numbers: { [key: number]: string } = {
      48: '0', 49: '1', 50: '2', 51: '3', 52: '4',
      53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
      3: '2', // Alternate scan code for '2'
    };

    if (numbers[scanCode]) {
      return numbers[scanCode];
    }

    // Special keys
    if (scanCode === 32) return ' '; // Space
    if (scanCode === 8) return '\b'; // Backspace
    if (scanCode === 13 || scanCode === 28) return '\n'; // Enter

    return null;
  }

  /**
   * Update text buffer based on keystroke
   */
  private updateTextBuffer(char: string, scanCode: number) {
    if (char === '\b') {
      // Backspace
      if (this.textBuffer.length > 0) {
        this.textBuffer = this.textBuffer.slice(0, -1);
      }
    } else if (char === '\n') {
      // Enter - add newline
      this.textBuffer += '\n';
    } else {
      // Regular character
      this.textBuffer += char;
    }

    // Limit buffer size
    if (this.textBuffer.length > this.MAX_BUFFER_SIZE) {
      this.textBuffer = this.textBuffer.slice(-this.MAX_BUFFER_SIZE);
    }
  }

  /**
   * Check current text state for trigger
   */
  private checkTextState() {
    const currentText = this.textBuffer;

    // Look for @prompt trigger - match everything after @prompt until end or newline
    // Use greedy matching to capture the full prompt text
    const triggerMatch = currentText.match(/@prompt\s+(.+)/i);

    if (triggerMatch) {
      const promptText = triggerMatch[1].trim();
      const triggerIndex = triggerMatch.index!;

      // Only emit if prompt text actually changed
      if (promptText !== this.lastEmittedPromptText || this.lastEmittedState !== "found") {
        this.lastEmittedPromptText = promptText;
        this.lastEmittedState = "found";

        const eventData = {
          promptText,
          triggerIndex,
          fullText: currentText
        };

        this.emit("trigger-found", eventData);
      }
    } else {
      // Check if @prompt exists but no space after it yet
      const partialMatch = currentText.match(/@prompt\s*$/i);
      if (partialMatch) {
        if (this.lastEmittedState !== "partial") {
          this.lastEmittedState = "partial";
          this.emit("trigger-partial");
        }
      } else {
        if (this.lastEmittedState !== "not-found") {
          this.lastEmittedPromptText = "";
          this.lastEmittedState = "not-found";
          this.emit("trigger-not-found");
        }
      }
    }
  }
}

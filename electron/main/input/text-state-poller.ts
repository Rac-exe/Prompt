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
  private ctrlPressed: boolean = false;
  private isRunning: boolean = false;
  private trackedInstances = new Map<string, { promptText: string; triggerIndex: number }>();
  private isReplacingText: boolean = false; // Flag to prevent self-triggering during text replacement
  private replacementTimeout: NodeJS.Timeout | null = null;

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
   * Clear text buffer and tracked instances
   * Called after successful text replacement to avoid stale detections
   */
  clearBuffer(): void {
    this.textBuffer = "";
    this.trackedInstances.clear();
    console.log("[TextStatePoller] Buffer cleared after text replacement");
  }

  /**
   * Signal that text replacement is in progress
   * This prevents paste detection from triggering during keyboard fallback
   */
  startReplacingText(): void {
    this.isReplacingText = true;
    console.log("[TextStatePoller] Text replacement started - ignoring paste events");

    // Clear any existing timeout
    if (this.replacementTimeout) {
      clearTimeout(this.replacementTimeout);
    }

    // Auto-clear flag after 1500ms (safety timeout)
    // Keyboard fallback takes 350-550ms total, so 1500ms ensures flag remains set
    this.replacementTimeout = setTimeout(() => {
      this.isReplacingText = false;
      console.log("[TextStatePoller] Text replacement timeout - re-enabling paste detection");
    }, 1500);
  }

  /**
   * Signal that text replacement is complete
   */
  stopReplacingText(): void {
    this.isReplacingText = false;
    if (this.replacementTimeout) {
      clearTimeout(this.replacementTimeout);
      this.replacementTimeout = null;
    }
    console.log("[TextStatePoller] Text replacement complete - paste detection re-enabled");
  }

  // REMOVED: resetState() method
  // No longer needed - session stays alive in SHOWING phase to prevent re-optimization

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

      // Track Ctrl state (scan codes: 29 for left Ctrl, 157 for right Ctrl, 162 for VK_CONTROL)
      if (scanCode === 29 || scanCode === 157 || scanCode === 162 || scanCode === 17) {
        if (event?.state === 'DOWN') {
          this.ctrlPressed = true;
        } else if (event?.state === 'UP') {
          this.ctrlPressed = false;
        }
        return;
      }

      // Detect Ctrl+V (paste)
      if (this.ctrlPressed && (scanCode === 86 || scanCode === 47)) {
        if (event?.state === 'DOWN') {
          this.handlePaste();
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
   * Handle paste event (Ctrl+V)
   * Reads clipboard and appends to text buffer
   */
  private async handlePaste() {
    // CRITICAL: Ignore paste events during text replacement to prevent infinite loops
    if (this.isReplacingText) {
      console.log('[TextStatePoller] Paste event ignored - text replacement in progress');
      return;
    }

    try {
      const { clipboard } = require('electron');
      const clipboardText = clipboard.readText();

      if (clipboardText && clipboardText.length > 0) {
        console.log(`[TextStatePoller] Paste detected - adding ${clipboardText.length} chars to buffer`);

        // Append clipboard text to buffer
        this.textBuffer += clipboardText;

        // Limit buffer size
        if (this.textBuffer.length > this.MAX_BUFFER_SIZE) {
          this.textBuffer = this.textBuffer.slice(-this.MAX_BUFFER_SIZE);
        }

        // Immediately check for triggers after paste
        this.checkTextState();
      }
    } catch (error) {
      console.error('[TextStatePoller] Failed to read clipboard on paste:', error);
    }
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
   * Finds ALL @prompt instances in buffer and tracks them independently
   */
  private checkTextState() {
    const currentText = this.textBuffer;

    // Multi-line regex: [\s\S] matches ANY character including newlines
    // +? = non-greedy (stop at earliest match)
    // (?=\n@prompt|$) = lookahead: stop before next @prompt or end of buffer
    // Use matchAll with 'g' flag to find ALL instances
    const regex = /@prompt\s+([\s\S]+?)(?=\n@prompt|$)/gi;
    const matches = Array.from(currentText.matchAll(regex));

    // Track current instances found in this scan
    const currentInstances = new Map<string, { promptText: string; triggerIndex: number }>();

    // Process each match
    matches.forEach((match) => {
      const promptText = match[1].trim();
      const triggerIndex = match.index!;

      // Generate hash for this instance (content + approximate position)
      const instanceHash = this.generateInstanceHash(promptText, triggerIndex);

      // Store in current scan
      currentInstances.set(instanceHash, { promptText, triggerIndex });

      // Check if this is a new or updated instance
      const tracked = this.trackedInstances.get(instanceHash);

      if (!tracked || tracked.promptText !== promptText) {
        // New or updated instance - emit event
        const lineCount = promptText.split('\n').length;

        // Only log on first detection (not every character)
        // console.log(
        //   `[TextStatePoller] Instance detected at ${triggerIndex}:`,
        //   `${lineCount} line(s),`,
        //   `${promptText.length} chars,`,
        //   `preview: "${promptText.substring(0, 50)}..."`
        // );

        this.emit("trigger-found", {
          promptText,
          triggerIndex,
          instanceHash,
          fullText: currentText
        });
      }
    });

    // Check for removed instances (were tracked, now gone)
    this.trackedInstances.forEach((instance, hash) => {
      if (!currentInstances.has(hash)) {
        // console.log(`[TextStatePoller] Instance removed at ${instance.triggerIndex}`);
        this.emit("trigger-removed", { instanceHash: hash });
      }
    });

    // Update tracked instances
    this.trackedInstances = currentInstances;

    // Emit trigger-not-found only if NO instances exist
    if (matches.length === 0 && this.trackedInstances.size > 0) {
      console.log("[TextStatePoller] All triggers removed");
      this.emit("trigger-not-found");
    }
  }

  /**
   * Generate unique hash for a prompt instance
   * Based on content (first 100 chars) + approximate position
   */
  private generateInstanceHash(promptText: string, triggerIndex: number): string {
    // Use first 100 chars for content identity
    const contentKey = promptText.substring(0, 100).replace(/\s+/g, '_');

    // Bucket position to groups of 50 chars (handles small position drift)
    const positionBucket = Math.floor(triggerIndex / 50);

    return `${contentKey}_pos${positionBucket}`;
  }
}

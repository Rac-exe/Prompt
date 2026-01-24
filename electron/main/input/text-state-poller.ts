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
  private trackedInstances = new Map<string, { promptText: string; triggerIndex: number; cursorPosition: number }>();
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
   * Uses key names (platform-independent) instead of scan codes
   */
  private setupKeystrokeListener() {
    if (!this.listener) {
      return;
    }

    // Debug: Log first few keystrokes to verify capture is working
    let debugCount = 0;
    const MAX_DEBUG_LOGS = 10;

    this.listener.addListener((event: any) => {
      // Use key name (platform-independent) - works on both Windows and macOS
      const keyName = event?.name?.toUpperCase();
      const state = event?.state;
      
      // Debug: Log first few events to verify capture is working
      if (debugCount < MAX_DEBUG_LOGS && state === 'DOWN') {
        console.log(`[TextStatePoller] Key captured: "${keyName}" (${debugCount + 1}/${MAX_DEBUG_LOGS})`);
        debugCount++;
      }
      
      if (!keyName) {
        // Debug: log raw event to understand what we're getting
        console.log('[TextStatePoller] Raw event (no keyName):', JSON.stringify(event));
        return;
      }

      // Track shift state
      if (keyName === 'LEFT SHIFT' || keyName === 'RIGHT SHIFT' || keyName === 'SHIFT') {
        if (state === 'DOWN') {
          this.shiftPressed = true;
        } else if (state === 'UP') {
          this.shiftPressed = false;
        }
        return;
      }

      // Track Ctrl/Cmd state (Cmd on macOS, Ctrl on Windows)
      if (keyName === 'LEFT CTRL' || keyName === 'RIGHT CTRL' || keyName === 'CTRL' ||
          keyName === 'LEFT META' || keyName === 'RIGHT META' || keyName === 'META') {
        if (state === 'DOWN') {
          this.ctrlPressed = true;
        } else if (state === 'UP') {
          this.ctrlPressed = false;
        }
        return;
      }

      // Detect Ctrl+V / Cmd+V (paste)
      if (this.ctrlPressed && keyName === 'V') {
        if (state === 'DOWN') {
          this.handlePaste();
        }
        return;
      }

      // Only process keydown events
      if (state !== 'DOWN') return;

      // Convert key name to character
      let char = this.keyNameToChar(keyName);
      if (!char) return;

      // Handle shift-modified keys
      if (this.shiftPressed) {
        const shiftChar = this.getShiftedChar(keyName);
        if (shiftChar) {
          char = shiftChar;
        }
      }

      this.updateTextBuffer(char, 0);
    });
  }

  /**
   * Convert key name to character (platform-independent)
   */
  private keyNameToChar(keyName: string): string | null {
    // Single letter keys (A-Z)
    if (keyName.length === 1 && keyName >= 'A' && keyName <= 'Z') {
      return keyName.toLowerCase();
    }

    // Number keys (including numpad)
    const numberMap: { [key: string]: string } = {
      '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
      '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
      'NUMPAD 0': '0', 'NUMPAD 1': '1', 'NUMPAD 2': '2', 'NUMPAD 3': '3', 'NUMPAD 4': '4',
      'NUMPAD 5': '5', 'NUMPAD 6': '6', 'NUMPAD 7': '7', 'NUMPAD 8': '8', 'NUMPAD 9': '9',
    };
    if (numberMap[keyName]) {
      return numberMap[keyName];
    }

    // Special keys
    const specialMap: { [key: string]: string } = {
      'SPACE': ' ',
      'BACKSPACE': '\b',
      'RETURN': '\n',
      'ENTER': '\n',
      'TAB': '\t',
      'DOT': '.',
      'COMMA': ',',
      'MINUS': '-',
      'EQUALS': '=',
      'SEMICOLON': ';',
      'QUOTE': "'",
      'BACKQUOTE': '`',
      'BRACKET LEFT': '[',
      'BRACKET RIGHT': ']',
      'BACKSLASH': '\\',
      'SLASH': '/',
    };
    if (specialMap[keyName]) {
      return specialMap[keyName];
    }

    return null;
  }

  /**
   * Get the shifted version of a character
   */
  private getShiftedChar(keyName: string): string | null {
    const shiftMap: { [key: string]: string } = {
      '1': '!',
      '2': '@',
      '3': '#',
      '4': '$',
      '5': '%',
      '6': '^',
      '7': '&',
      '8': '*',
      '9': '(',
      '0': ')',
      'MINUS': '_',
      'EQUALS': '+',
      'BRACKET LEFT': '{',
      'BRACKET RIGHT': '}',
      'BACKSLASH': '|',
      'SEMICOLON': ':',
      'QUOTE': '"',
      'COMMA': '<',
      'DOT': '>',
      'SLASH': '?',
      'BACKQUOTE': '~',
    };
    
    if (shiftMap[keyName]) {
      return shiftMap[keyName];
    }
    
    // Uppercase letters
    if (keyName.length === 1 && keyName >= 'A' && keyName <= 'Z') {
      return keyName; // Already uppercase
    }
    
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
  private updateTextBuffer(char: string, _scanCode: number) {
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

    // Debug: Show buffer state (uncomment for debugging)
    // console.log(`[TextStatePoller] Buffer: "${this.textBuffer.slice(-20)}"`);

    // Limit buffer size
    if (this.textBuffer.length > this.MAX_BUFFER_SIZE) {
      this.textBuffer = this.textBuffer.slice(-this.MAX_BUFFER_SIZE);
    }
    
    // Check for @prompt immediately after each keystroke for faster detection
    if (this.textBuffer.endsWith('@prompt') || this.textBuffer.endsWith('@PROMPT')) {
      console.log('[TextStatePoller] @prompt detected immediately after keystroke!');
      this.checkTextState();
    }
  }

  /**
   * Check current text state for trigger
   * NEW WORKFLOW: Only detect @prompt (7 characters), don't capture text after it
   * The cursor position is calculated as triggerIndex + 7 (length of "@prompt")
   */
  private checkTextState() {
    const currentText = this.textBuffer;

    // NEW: Simple regex - just find "@prompt" (case insensitive)
    // No text capture after @prompt - just detect the trigger itself
    const regex = /@prompt/gi;
    const matches = Array.from(currentText.matchAll(regex));

    // Track current instances found in this scan
    const currentInstances = new Map<string, { promptText: string; triggerIndex: number; cursorPosition: number }>();

    // Process each match
    matches.forEach((match) => {
      const triggerIndex = match.index!;
      const cursorPosition = triggerIndex + 7; // Cursor is at position 7 (after "@prompt")

      // Generate hash for this instance (position-based since there's no text)
      const instanceHash = this.generateInstanceHash("@prompt", triggerIndex);

      // Store in current scan
      currentInstances.set(instanceHash, {
        promptText: "@prompt", // Just the trigger itself
        triggerIndex,
        cursorPosition
      });

      // Check if this is a new instance
      const tracked = this.trackedInstances.get(instanceHash);

      if (!tracked) {
        // New instance detected - emit event
        console.log(
          `[TextStatePoller] @prompt detected at position ${triggerIndex}, cursor at ${cursorPosition}`
        );

        this.emit("trigger-found", {
          promptText: "@prompt", // No text captured
          triggerIndex,
          cursorPosition, // NEW: Exact cursor position for replacement
          instanceHash,
          fullText: currentText
        });
      }
    });

    // Check for removed instances (were tracked, now gone)
    this.trackedInstances.forEach((instance, hash) => {
      if (!currentInstances.has(hash)) {
        console.log(`[TextStatePoller] @prompt removed at ${instance.triggerIndex}`);
        this.emit("trigger-removed", { instanceHash: hash });
      }
    });

    // Update tracked instances
    this.trackedInstances = currentInstances;

    // Emit trigger-not-found only if NO instances exist
    if (matches.length === 0 && this.trackedInstances.size > 0) {
      console.log("[TextStatePoller] All @prompt triggers removed");
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

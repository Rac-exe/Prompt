import { GlobalKeyboardListener } from "node-global-key-listener";
import { EventEmitter } from "events";

// Convert scan code to key name
// This library appears to use ASCII codes for letters (65=A, 66=B, etc.)
// and scan codes for special keys
function scanCodeToKeyName(scanCode: number): string {
  // ASCII codes for letters (A-Z: 65-90, a-z: 97-122)
  // But the library seems to use uppercase ASCII codes
  if (scanCode >= 65 && scanCode <= 90) {
    return String.fromCharCode(scanCode); // 'A' to 'Z'
  }
  
  // Special keys mapping (based on observed scan codes)
  const specialKeys: { [key: number]: string } = {
    8: 'BACKSPACE',
    9: 'TAB',
    13: 'ENTER', // ENTER key (carriage return)
    28: 'ENTER', // ENTER key (standard scan code)
    32: 'SPACE',
    162: 'LEFT CTRL',
    164: 'LEFT ALT',
    3: '2', // "2" key (standard scan code, with shift = "@")
    50: '2', // "2" key (library-specific scan code, with shift = "@")
    // Number keys (library might use different codes)
    48: '0', 49: '1', 51: '3', 52: '4', 53: '5',
    54: '6', 55: '7', 56: '8', 57: '9',
    // Add more as needed
  };
  
  if (specialKeys[scanCode]) {
    return specialKeys[scanCode];
  }
  
  return `UNKNOWN_${scanCode}`;
}

export class KeyboardHook extends EventEmitter {
  private listener: GlobalKeyboardListener | null = null;
  private buffer: string = "";
  private isCapturing: boolean = false;
  private isCapturingPrompt: boolean = false;
  private promptBuffer: string = "";
  private readonly TRIGGER = "@prompt";
  private lastKeyTime: number = 0;
  private readonly BUFFER_TIMEOUT = 10000; // 10 seconds to complete trigger @prompt (increased for slower typers)
  private debugKeyCount: number = 0;
  private logBuffer: string = ""; // Buffer for logging typed characters
  private shiftPressed: boolean = false; // Track shift state

  constructor() {
    super();
  }

  private setupListeners() {
    if (!this.listener) {
      return;
    }

    this.listener.addListener((event: any, isKeyDown?: any) => {
      // node-global-key-listener provides scanCode, not name
      // event.scanCode = Windows scan code
      // event.state = "DOWN" or "UP"
      
      const scanCode = event?.scanCode;
      if (!scanCode) return;
      
      // Track shift state (scan code 42/54 = standard shift, 160 = another shift variant)
      if (scanCode === 42 || scanCode === 54 || scanCode === 160) {
        if (event?.state === 'DOWN') {
          this.shiftPressed = true;
          console.log(`[SHIFT] Shift key DOWN, shiftPressed=${this.shiftPressed}`);
        } else if (event?.state === 'UP') {
          this.shiftPressed = false;
          console.log(`[SHIFT] Shift key UP, shiftPressed=${this.shiftPressed}`);
        }
        return; // Don't process shift key itself
      }
      
      // Only process keydown events for other keys
      if (event?.state !== 'DOWN') return;
      
      // Skip mouse events
      if (event?._raw?.startsWith('MOUSE')) return;
      
      // Convert scan code to key name
      let keyName = scanCodeToKeyName(scanCode);
      
      // Debug: log first 15 events with shift state (to see @ detection)
      if (this.debugKeyCount < 15) {
        console.log(`[DEBUG] scanCode: ${scanCode}, keyName: ${keyName}, shiftPressed: ${this.shiftPressed}`);
        this.debugKeyCount++;
      }
      
      // Handle shift-modified keys
      // Scan code 3 or 50 = "2" key, with shift = "@"
      if (this.shiftPressed && (scanCode === 3 || scanCode === 50)) {
        keyName = '@'; // Shift+2 = @
        console.log(`[DEBUG] Detected @ (Shift+2), scanCode: ${scanCode}, shiftPressed: ${this.shiftPressed}`);
      } else if (this.shiftPressed && scanCode >= 65 && scanCode <= 90) {
        keyName = String.fromCharCode(scanCode); // Already uppercase, keep it
      }

      const now = Date.now();
      
      // Clean logging format: log typed characters, spaces start new line
      if (keyName === 'SPACE') {
        if (this.logBuffer) {
          console.log(`[Typed] ${this.logBuffer}`);
          this.logBuffer = "";
        } else {
          console.log(`[Typed] <SPACE>`);
        }
      } else if (keyName === 'ENTER' || keyName === 'NUM ENTER') {
        if (this.logBuffer) {
          console.log(`[Typed] ${this.logBuffer}`);
          this.logBuffer = "";
        }
        console.log(`[Typed] <ENTER>`);
      } else if (keyName === 'BACKSPACE') {
        if (this.logBuffer.length > 0) {
          this.logBuffer = this.logBuffer.slice(0, -1);
        }
      } else if (keyName.match(/^[A-Z]$/)) {
        // Single letter keys (A-Z) - convert to lowercase for logging
        this.logBuffer += keyName.toLowerCase();
      } else if (keyName.length === 1 && /[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>?\/\-=]/.test(keyName)) {
        // Other printable characters
        this.logBuffer += keyName;
      }

      // Detect "@" to start capture FIRST (before timeout check)
      const isAtSymbol = keyName === "@";

      if (isAtSymbol && !this.isCapturing && !this.isCapturingPrompt) {
        this.isCapturing = true;
        this.buffer = "@";
        this.lastKeyTime = now; // Update lastKeyTime when starting capture
        console.log(`Started capturing trigger, detected @, buffer="${this.buffer}", isCapturing=${this.isCapturing}`);
        return;
      }

      // Reset if too much time passed between keys (only check if capturing trigger, NOT prompt text)
      // Check BEFORE updating lastKeyTime to use the previous key's timestamp
      // Note: This timeout only applies to @prompt trigger detection, not to prompt text capture
      if (this.isCapturing && !this.isCapturingPrompt && this.lastKeyTime > 0 && now - this.lastKeyTime > this.BUFFER_TIMEOUT) {
        console.log(`[TIMEOUT] Timeout detected during trigger capture: now=${now}, lastKeyTime=${this.lastKeyTime}, diff=${now - this.lastKeyTime}`);
        this.reset();
      }
      
      // Update lastKeyTime for next timeout check
      this.lastKeyTime = now;

      // Continue capturing if in trigger mode
      console.log(`[DEBUG STATE] Before trigger check: isCapturing=${this.isCapturing}, keyName="${keyName}"`);
      if (this.isCapturing) {
        console.log(`[TRIGGER] isCapturing=true, keyName="${keyName}", buffer="${this.buffer}"`);
        if (keyName === "SPACE") {
          if (this.buffer === this.TRIGGER) {
            // Trigger detected! Start capturing prompt text
            console.log("Trigger detected! Starting prompt capture...");
            this.emit("trigger-detected");
            this.buffer = "";
            this.isCapturing = false;
            this.isCapturingPrompt = true;
            this.promptBuffer = "";
            return;
          } else {
            // Not matching, reset
            console.log(`Buffer "${this.buffer}" doesn't match trigger, resetting`);
            this.reset();
          }
        } else if (keyName.match(/^[A-Z]$/)) {
          // Letter keys
          this.buffer += keyName.toLowerCase();
          console.log(`Trigger buffer: "${this.buffer}"`);
          
          // Check if still matching trigger
          if (!this.TRIGGER.startsWith(this.buffer)) {
            console.log(`Buffer "${this.buffer}" no longer matches trigger, resetting`);
            this.reset();
          }
        } else if (keyName === "BACKSPACE") {
          // Allow backspace to correct
          if (this.buffer.length > 0) {
            this.buffer = this.buffer.slice(0, -1);
            console.log(`Backspace, buffer now: "${this.buffer}"`);
          }
          if (this.buffer.length === 0) {
            this.reset();
          }
        } else {
          // Non-matching key, reset
          console.log(`Non-matching key "${keyName}" during trigger capture, resetting`);
          this.reset();
        }
      }

      // If we're capturing prompt text (after trigger detected)
      if (this.isCapturingPrompt) {
        if (keyName === "ENTER" || keyName === "RETURN") {
          // Check if Shift is currently pressed - if so, add newline instead of ending capture
          // Note: We need to check shift state at the moment Enter is pressed
          // The shiftPressed boolean tracks the state, but we should verify it's still true
          console.log(`[ENTER] Enter detected during prompt capture, shiftPressed=${this.shiftPressed}, scanCode=${scanCode}`);
          
          if (this.shiftPressed) {
            // Shift+Enter = newline, continue capturing
            this.promptBuffer += "\n";
            const preview = this.promptBuffer.length > 50 ? this.promptBuffer.substring(0, 50) + "..." : this.promptBuffer;
            console.log(`[ENTER] Shift+Enter pressed - newline added, buffer length: ${this.promptBuffer.length}, preview: "${preview.replace(/\n/g, '\\n')}"`);
            // Continue capturing - don't end
          } else {
            // Enter alone = end of prompt - emit the captured text
            const trimmed = this.promptBuffer.trim();
            if (trimmed.length > 0) {
              console.log("Prompt text captured:", trimmed);
              this.emit("prompt-text-captured", trimmed);
            } else {
              console.log("Enter pressed but prompt buffer is empty");
            }
            this.isCapturingPrompt = false;
            this.promptBuffer = "";
          }
        } else if (keyName === "ESCAPE") {
          // Cancel capture
          console.log("Prompt capture cancelled");
          this.isCapturingPrompt = false;
          this.promptBuffer = "";
        } else if (keyName === "BACKSPACE" || keyName === "DELETE") {
          // Handle backspace
          if (this.promptBuffer.length > 0) {
            this.promptBuffer = this.promptBuffer.slice(0, -1);
          }
        } else if (keyName.match(/^[A-Z]$/)) {
          // Letter keys - convert to lowercase for prompt
          this.promptBuffer += keyName.toLowerCase();
          console.log(`Captured char: "${keyName.toLowerCase()}", buffer: "${this.promptBuffer}"`);
        } else if (keyName.length === 1 && /[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>?\/]/.test(keyName)) {
          // Other printable characters
          this.promptBuffer += keyName;
          console.log(`Captured char: "${keyName}", buffer: "${this.promptBuffer}"`);
        } else if (keyName === "SPACE") {
          // Handle space in prompt text
          this.promptBuffer += " ";
          console.log(`Captured space, buffer: "${this.promptBuffer}"`);
        }
      }
    });
  }

  private reset() {
    console.log(`[RESET] Resetting capture state, was isCapturing=${this.isCapturing}`);
    this.buffer = "";
    this.isCapturing = false;
    this.isCapturingPrompt = false;
    this.promptBuffer = "";
    // Don't reset logBuffer - let it accumulate until space/enter
  }

  start() {
    try {
      console.log("[KeyboardHook] Creating GlobalKeyboardListener...");
      this.listener = new GlobalKeyboardListener();
      console.log("[KeyboardHook] GlobalKeyboardListener created, setting up listeners...");
      this.setupListeners();
      console.log("[KeyboardHook] Keyboard hook started and ready");
      console.log("[KeyboardHook] Listening for keyboard events...");
    } catch (error) {
      console.error("[KeyboardHook] Failed to start keyboard hook:", error);
      throw error;
    }
  }

  stop() {
    if (this.listener) {
      try {
        this.listener.kill();
      } catch (error) {
        console.error("Error stopping keyboard hook:", error);
      }
      this.listener = null;
    }
    this.removeAllListeners();
    this.reset();
  }
}

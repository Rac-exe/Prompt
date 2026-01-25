import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { uIOhook, UiohookKey } from "uiohook-napi";
import { FloatingPanel } from "./overlay/floating-panel";
import { PythonClient } from "./api/python-client";

// ============================================
// GLOBAL STATE
// ============================================
let floatingPanel: FloatingPanel | null = null;
let pythonClient: PythonClient | null = null;
let isPanelVisible = false;

// Keystroke tracking for @prompt detection
let typedBuffer = "";
const TRIGGER_PHRASE = "@prompt";
const MAX_BUFFER_SIZE = 50;
let shiftPressed = false;

// ============================================
// KEY CODE MAPPING (from Ghost's inputEvents.js)
// ============================================
const KEYCODE_MAP: { [key: number]: string } = {
  // Number row
  [UiohookKey.Backquote]: '`',
  [UiohookKey['1']]: '1',
  [UiohookKey['2']]: '2',
  [UiohookKey['3']]: '3',
  [UiohookKey['4']]: '4',
  [UiohookKey['5']]: '5',
  [UiohookKey['6']]: '6',
  [UiohookKey['7']]: '7',
  [UiohookKey['8']]: '8',
  [UiohookKey['9']]: '9',
  [UiohookKey['0']]: '0',
  [UiohookKey.Minus]: '-',
  [UiohookKey.Equal]: '=',
  [UiohookKey.Backspace]: '\b',
  
  // Letters
  [UiohookKey.Q]: 'q',
  [UiohookKey.W]: 'w',
  [UiohookKey.E]: 'e',
  [UiohookKey.R]: 'r',
  [UiohookKey.T]: 't',
  [UiohookKey.Y]: 'y',
  [UiohookKey.U]: 'u',
  [UiohookKey.I]: 'i',
  [UiohookKey.O]: 'o',
  [UiohookKey.P]: 'p',
  [UiohookKey.BracketLeft]: '[',
  [UiohookKey.BracketRight]: ']',
  [UiohookKey.Backslash]: '\\',
  [UiohookKey.A]: 'a',
  [UiohookKey.S]: 's',
  [UiohookKey.D]: 'd',
  [UiohookKey.F]: 'f',
  [UiohookKey.G]: 'g',
  [UiohookKey.H]: 'h',
  [UiohookKey.J]: 'j',
  [UiohookKey.K]: 'k',
  [UiohookKey.L]: 'l',
  [UiohookKey.Semicolon]: ';',
  [UiohookKey.Quote]: "'",
  [UiohookKey.Z]: 'z',
  [UiohookKey.X]: 'x',
  [UiohookKey.C]: 'c',
  [UiohookKey.V]: 'v',
  [UiohookKey.B]: 'b',
  [UiohookKey.N]: 'n',
  [UiohookKey.M]: 'm',
  [UiohookKey.Comma]: ',',
  [UiohookKey.Period]: '.',
  [UiohookKey.Slash]: '/',
  [UiohookKey.Space]: ' ',
  [UiohookKey.Enter]: '\n',
};

// Shift symbol mapping
const SHIFT_MAP: { [key: string]: string } = {
  '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
  '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', '-': '_',
  '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"',
  ',': '<', '.': '>', '/': '?',
};

// ============================================
// KEYSTROKE DETECTION (using uiohook-napi like Ghost)
// ============================================
function startKeystrokeDetection() {
  console.log("[Main] Starting keystroke detection with uiohook-napi...");
  
  // Debug counter
  let debugCount = 0;
  const MAX_DEBUG = 15;
  
  // Handle keydown events
  uIOhook.on('keydown', (event: any) => {
    // Debug: Log first few keystrokes
    if (debugCount < MAX_DEBUG) {
      console.log(`[Main] Key DOWN: keycode=${event.keycode}, shiftKey=${event.shiftKey}`);
      debugCount++;
    }
    
    // Track shift state
    if (event.keycode === UiohookKey.Shift || event.keycode === UiohookKey.ShiftRight) {
      shiftPressed = true;
      return;
    }
    
    // Get character from keycode
    let char = KEYCODE_MAP[event.keycode];
    if (!char) return;
    
    // Apply shift modifier
    if (event.shiftKey || shiftPressed) {
      if (char.length === 1 && /[a-z]/.test(char)) {
        char = char.toUpperCase();
      } else if (SHIFT_MAP[char]) {
        char = SHIFT_MAP[char];
      }
    }
    
    // Handle backspace
    if (char === '\b') {
      typedBuffer = typedBuffer.slice(0, -1);
      console.log(`[Main] Backspace - Buffer: "${typedBuffer.slice(-15)}"`);
      return;
    }
    
    // Skip enter/newline
    if (char === '\n') return;
    
    // Add to buffer
    typedBuffer += char;
    
    // Keep buffer small
    if (typedBuffer.length > MAX_BUFFER_SIZE) {
      typedBuffer = typedBuffer.slice(-MAX_BUFFER_SIZE);
    }
    
    console.log(`[Main] Char: "${char}" -> Buffer: "${typedBuffer.slice(-15)}"`);
    
    // Check for @prompt trigger (case insensitive)
    if (typedBuffer.toLowerCase().endsWith(TRIGGER_PHRASE)) {
      console.log("[Main] *** @prompt DETECTED! Showing overlay... ***");
      showOverlay();
      // Clear buffer after trigger
      typedBuffer = "";
    }
  });
  
  // Handle keyup for shift tracking
  uIOhook.on('keyup', (event: any) => {
    if (event.keycode === UiohookKey.Shift || event.keycode === UiohookKey.ShiftRight) {
      shiftPressed = false;
    }
  });
  
  // Start uiohook
  uIOhook.start();
  
  console.log("[Main] uiohook-napi started successfully");
  console.log("[Main] Type some keys to test - you should see logs...");
}

function stopKeystrokeDetection() {
  console.log("[Main] Stopping uiohook-napi...");
  uIOhook.stop();
  console.log("[Main] uiohook-napi stopped");
}

// ============================================
// OVERLAY CONTROL
// ============================================
function showOverlay() {
  if (!floatingPanel) return;
  
  if (!isPanelVisible) {
    console.log("[Main] Showing floating panel...");
    floatingPanel.showAndFocusInput();
    isPanelVisible = true;
  } else {
    // Already visible, just focus input
    const panelWindow = floatingPanel.getWindow();
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.focus();
      panelWindow.webContents.send("focus-input");
    }
  }
}

function hideOverlay() {
  if (floatingPanel) {
    floatingPanel.hide();
    isPanelVisible = false;
    console.log("[Main] Floating panel hidden");
  }
}

function toggleOverlay() {
  if (isPanelVisible) {
    hideOverlay();
  } else {
    showOverlay();
  }
}

// ============================================
// IPC HANDLERS
// ============================================
function setupIPC() {
  // Handle panel dismissal
  ipcMain.on("floating-panel:dismiss", () => {
    console.log("[Main] Panel dismissed");
    hideOverlay();
  });
  
  // Handle when panel transitions to collapsed state (user clicked close button)
  ipcMain.on("floating-panel:resize-and-reposition", (event, data: { width: number; height: number; fromState: string }) => {
    // If resizing to collapsed state (64x64 orb), treat as hidden
    if (data.width === 64 && data.height === 64) {
      console.log("[Main] Panel collapsed to orb - marking as not visible");
      isPanelVisible = false;
    }
  });
  
  // Handle prompt submission for optimization
  ipcMain.on("floating-panel:prompt-submit", async (event, data: string | { text: string; isRegenerate?: boolean }) => {
    const promptText = (typeof data === 'string' ? data : data?.text) || "";
    const skipCache = typeof data === 'string' ? false : !!data?.isRegenerate;
    
    console.log("[Main] Prompt submitted:", promptText.substring(0, 50), skipCache ? "(Regenerate)" : "");
    
    if (!pythonClient) {
      console.error("[Main] Python client not available");
      return;
    }
    
    try {
      // Call Python service for optimization
      const optimizedText = await pythonClient.optimize(promptText, skipCache);
      
      // Send result back to renderer
      const panelWindow = floatingPanel?.getWindow();
      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.webContents.send("optimization-complete", {
          original: promptText,
          optimized: optimizedText
        });
      }
    } catch (error) {
      console.error("[Main] Optimization failed:", error);
      // Send error to renderer
      const panelWindow = floatingPanel?.getWindow();
      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.webContents.send("optimization-complete", {
          original: promptText,
          optimized: "Optimization failed. Please check if Python service is running."
        });
      }
    }
  });
  
  // Handle replace button click
  ipcMain.on("floating-panel:replace-text", (event, data: { optimizedText: string }) => {
    console.log("[Main] Replace requested - copying to clipboard");
    const { clipboard } = require("electron");
    clipboard.writeText(data.optimizedText);
    hideOverlay();
  });
}

// ============================================
// APP INITIALIZATION
// ============================================
async function initialize() {
  console.log("[Main] Initializing Prompt Optimizer...");
  
  // Initialize Python client
  pythonClient = new PythonClient("http://127.0.0.1:8001");
  
  try {
    const isHealthy = await pythonClient.healthCheck();
    if (isHealthy) {
      console.log("[Main] Python service connected");
    } else {
      console.warn("[Main] Python service not available. Start with: npm run python:dev:mac");
    }
  } catch (error) {
    console.warn("[Main] Could not connect to Python service");
  }
  
  // Create floating panel
  floatingPanel = new FloatingPanel();
  floatingPanel.create();
  floatingPanel.hide(); // Start hidden
  console.log("[Main] Floating panel created (hidden)");
  
  // Listen for panel events
  floatingPanel.on("panel-dismissed", () => {
    isPanelVisible = false;
    console.log("[Main] Panel dismissed via event");
  });
  
  // Setup IPC handlers
  setupIPC();
  
  // Start keystroke detection for @prompt
  startKeystrokeDetection();
  
  // Register global hotkey Ctrl+5 / Cmd+5 to toggle panel
  const registered = globalShortcut.register("CommandOrControl+5", () => {
    console.log("[Main] Ctrl+5 / Cmd+5 pressed");
    toggleOverlay();
  });
  
  if (registered) {
    console.log("[Main] Global hotkey registered: Ctrl+5 (or Cmd+5 on macOS)");
  } else {
    console.error("[Main] Failed to register global hotkey");
  }
  
  console.log("[Main] ========================================");
  console.log("[Main] Prompt Optimizer ready!");
  console.log("[Main] - Type '@prompt' anywhere to open overlay");
  console.log("[Main] - Press Ctrl+5 / Cmd+5 to toggle overlay");
  console.log("[Main] ========================================");
}

async function shutdown() {
  console.log("[Main] Shutting down...");
  stopKeystrokeDetection();
  globalShortcut.unregisterAll();
  if (floatingPanel) {
    floatingPanel.destroy();
  }
  console.log("[Main] Shutdown complete");
}

// ============================================
// APP LIFECYCLE
// ============================================
app.whenReady().then(async () => {
  await initialize();
});

app.on("window-all-closed", () => {
  // Keep running in background - this is a system-wide utility
});

app.on("activate", async () => {
  // macOS: recreate if needed
  if (!floatingPanel) {
    await initialize();
  }
});

app.on("before-quit", async () => {
  await shutdown();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Focus overlay if user tries to open another instance
    showOverlay();
  });
}

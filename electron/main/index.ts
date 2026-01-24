import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { GlobalKeyboardListener } from "node-global-key-listener";
import { FloatingPanel } from "./overlay/floating-panel";
import { PythonClient } from "./api/python-client";
import * as path from "path";

// ============================================
// GLOBAL STATE
// ============================================
let floatingPanel: FloatingPanel | null = null;
let pythonClient: PythonClient | null = null;
let keyboardListener: GlobalKeyboardListener | null = null;
let isPanelVisible = false;

// Keystroke tracking for @prompt detection
let typedBuffer = "";
const TRIGGER_PHRASE = "@prompt";
const MAX_BUFFER_SIZE = 50;
let shiftPressed = false;

// ============================================
// KEYSTROKE DETECTION (Simple, Ghost-style)
// ============================================
function startKeystrokeDetection() {
  console.log("[Main] Starting keystroke detection for @prompt...");
  
  try {
    keyboardListener = new GlobalKeyboardListener();
    
    keyboardListener.addListener((event: any) => {
      const keyName = event?.name?.toUpperCase();
      const state = event?.state;
      
      if (!keyName) return;
      
      // Track shift state
      if (keyName.includes('SHIFT')) {
        shiftPressed = state === 'DOWN';
        return;
      }
      
      // Only process key down events
      if (state !== 'DOWN') return;
      
      // Convert key to character
      const char = keyToChar(keyName, shiftPressed);
      if (!char) return;
      
      // Handle backspace
      if (char === '\b') {
        typedBuffer = typedBuffer.slice(0, -1);
        return;
      }
      
      // Add to buffer
      typedBuffer += char;
      
      // Keep buffer small
      if (typedBuffer.length > MAX_BUFFER_SIZE) {
        typedBuffer = typedBuffer.slice(-MAX_BUFFER_SIZE);
      }
      
      // Check for @prompt trigger (case insensitive)
      if (typedBuffer.toLowerCase().endsWith(TRIGGER_PHRASE)) {
        console.log("[Main] @prompt detected! Showing overlay...");
        showOverlay();
        // Clear buffer after trigger to prevent re-triggering
        typedBuffer = "";
      }
    });
    
    console.log("[Main] Keystroke detection started successfully");
  } catch (error) {
    console.error("[Main] Failed to start keystroke detection:", error);
  }
}

function keyToChar(keyName: string, shift: boolean): string | null {
  // Single letters
  if (keyName.length === 1 && keyName >= 'A' && keyName <= 'Z') {
    return shift ? keyName : keyName.toLowerCase();
  }
  
  // Numbers and their shift variants
  const numberMap: { [key: string]: [string, string] } = {
    '1': ['1', '!'], '2': ['2', '@'], '3': ['3', '#'], '4': ['4', '$'], '5': ['5', '%'],
    '6': ['6', '^'], '7': ['7', '&'], '8': ['8', '*'], '9': ['9', '('], '0': ['0', ')'],
  };
  if (numberMap[keyName]) {
    return shift ? numberMap[keyName][1] : numberMap[keyName][0];
  }
  
  // Special keys
  const specialMap: { [key: string]: string } = {
    'SPACE': ' ',
    'BACKSPACE': '\b',
  };
  if (specialMap[keyName]) {
    return specialMap[keyName];
  }
  
  return null;
}

function stopKeystrokeDetection() {
  if (keyboardListener) {
    keyboardListener.kill();
    keyboardListener = null;
    console.log("[Main] Keystroke detection stopped");
  }
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
  
  // Handle prompt submission for optimization
  ipcMain.on("floating-panel:prompt-submit", async (event, promptText: string) => {
    console.log("[Main] Prompt submitted:", promptText.substring(0, 50));
    
    if (!pythonClient) {
      console.error("[Main] Python client not available");
      return;
    }
    
    try {
      // Call Python service for optimization
      const optimizedText = await pythonClient.optimize(promptText);
      
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

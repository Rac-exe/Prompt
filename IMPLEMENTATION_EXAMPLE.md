# Implementation Example: Core Components

This document provides concrete code examples for key components of the prompt optimization app.

## 1. Electron Main Process - Input Monitor

```typescript
// electron/main/input/keyboard-hook.ts
import { GlobalKeyboardListener } from "node-global-key-listener";
import { EventEmitter } from "events";

export class KeyboardHook extends EventEmitter {
  private listener: GlobalKeyboardListener;
  private buffer: string = "";
  private isCapturing: boolean = false;
  private readonly TRIGGER = "@prompt";

  constructor() {
    super();
    this.listener = new GlobalKeyboardListener();
    this.setupListeners();
  }

  private setupListeners() {
    this.listener.addListener((e, down) => {
      if (!down) return; // Only process keydown events

      // Reset if too much time passed or buffer too long
      if (this.buffer.length > 50) {
        this.reset();
      }

      // Detect "@" to start capture
      if (e.name === "@" || (e.name === "2" && e.shift)) {
        this.isCapturing = true;
        this.buffer = "@";
        return;
      }

      // Continue capturing if in trigger mode
      if (this.isCapturing) {
        if (e.name === "SPACE") {
          if (this.buffer === this.TRIGGER) {
            // Trigger detected!
            this.emit("trigger-detected");
            this.buffer = "";
            this.isCapturing = false;
            return;
          } else {
            // Not matching, reset
            this.reset();
          }
        } else if (e.name.length === 1 && /[a-zA-Z0-9]/.test(e.name)) {
          this.buffer += e.name.toLowerCase();
          
          // Check if still matching trigger
          if (!this.TRIGGER.startsWith(this.buffer)) {
            this.reset();
          }
        } else {
          // Non-alphanumeric key, reset
          this.reset();
        }
      }
    });
  }

  private reset() {
    this.buffer = "";
    this.isCapturing = false;
  }

  start() {
    // Hook is active once listener is created
    console.log("Keyboard hook started");
  }

  stop() {
    this.listener.kill();
    this.removeAllListeners();
  }
}
```

## 2. Context Tracker

```typescript
// electron/main/context/window-tracker.ts
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface WindowContext {
  handle: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  processName: string;
}

export class WindowTracker {
  private currentContext: WindowContext | null = null;
  private updateInterval: NodeJS.Timeout | null = null;

  async getActiveWindow(): Promise<WindowContext> {
    if (process.platform === "win32") {
      return this.getWindowsActiveWindow();
    } else if (process.platform === "darwin") {
      return this.getMacOSActiveWindow();
    }
    throw new Error("Unsupported platform");
  }

  private async getWindowsActiveWindow(): Promise<WindowContext> {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class Win32 {
          [DllImport("user32.dll")]
          public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")]
          public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
          [DllImport("user32.dll")]
          public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
          [DllImport("user32.dll")]
          public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        }
        public struct RECT { public int Left, Top, Right, Bottom; }
"@
      $hwnd = [Win32]::GetForegroundWindow()
      $rect = New-Object RECT
      [Win32]::GetWindowRect($hwnd, [ref]$rect)
      $title = New-Object System.Text.StringBuilder 256
      [Win32]::GetWindowText($hwnd, $title, 256)
      $pid = 0
      [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid)
      $proc = Get-Process -Id $pid
      Write-Output "$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)|$($title.ToString())|$($proc.ProcessName)"
    `;

    try {
      const { stdout } = await execAsync(
        `powershell -Command "${script.replace(/"/g, '\\"')}"`
      );
      const parts = stdout.trim().split("|");
      const coords = parts[0].split(",").map(Number);
      
      return {
        handle: "unknown", // Would need native module for actual handle
        title: parts[1],
        bounds: {
          x: coords[0],
          y: coords[1],
          width: coords[2] - coords[0],
          height: coords[3] - coords[1]
        },
        processName: parts[2] || "unknown"
      };
    } catch (error) {
      throw new Error(`Failed to get window context: ${error}`);
    }
  }

  private async getMacOSActiveWindow(): Promise<WindowContext> {
    const script = `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        set frontWindow to window 1 of process frontApp
        set windowPosition to position of frontWindow
        set windowSize to size of frontWindow
        set windowTitle to title of frontWindow
      end tell
      return windowPosition & "|" & windowSize & "|" & windowTitle & "|" & frontApp
    `;

    try {
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const parts = stdout.trim().split("|");
      const pos = parts[0].split(", ").map(Number);
      const size = parts[1].split(", ").map(Number);
      
      return {
        handle: "unknown",
        title: parts[2] || "",
        bounds: {
          x: pos[0],
          y: pos[1],
          width: size[0],
          height: size[1]
        },
        processName: parts[3] || "unknown"
      };
    } catch (error) {
      throw new Error(`Failed to get window context: ${error}`);
    }
  }

  startTracking(intervalMs: number = 1000) {
    this.updateInterval = setInterval(async () => {
      try {
        this.currentContext = await this.getActiveWindow();
      } catch (error) {
        console.error("Failed to update window context:", error);
      }
    }, intervalMs);
  }

  stopTracking() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  getCurrentContext(): WindowContext | null {
    return this.currentContext;
  }
}
```

## 3. Prompt Capture Handler

```typescript
// electron/main/input/trigger-detector.ts
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
  private readonly CAPTURE_TIMEOUT = 5000; // 5 seconds

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

    // Monitor keyboard for prompt text
    // This is simplified - in reality, you'd need to capture
    // the actual text being typed, which is complex
    this.keyboardHook.on("key", (key: string) => {
      if (this.isCapturingPrompt) {
        this.handlePromptKey(key);
      }
    });
  }

  private startPromptCapture() {
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
  }

  private handlePromptKey(key: string) {
    // Check timeout
    if (Date.now() - this.captureStartTime > this.CAPTURE_TIMEOUT) {
      this.cancelCapture();
      return;
    }

    if (key === "ENTER" || key === "RETURN") {
      // End of prompt
      this.finishCapture();
    } else if (key.length === 1) {
      this.captureBuffer += key;
    }
  }

  private finishCapture() {
    if (this.captureBuffer.trim().length === 0) {
      this.cancelCapture();
      return;
    }

    const window = this.windowTracker.getCurrentContext();
    if (!window) {
      this.cancelCapture();
      return;
    }

    // Estimate cursor position (simplified)
    const estimatedCursorX = window.bounds.x + 50; // Rough estimate
    const estimatedCursorY = window.bounds.y + 50;

    const context: PromptContext = {
      window,
      promptText: this.captureBuffer.trim(),
      estimatedCursorX,
      estimatedCursorY,
      timestamp: Date.now()
    };

    this.emit("prompt-captured", context);
    this.reset();
  }

  private cancelCapture() {
    this.reset();
  }

  private reset() {
    this.isCapturingPrompt = false;
    this.captureBuffer = "";
    this.captureStartTime = 0;
  }

  start() {
    this.keyboardHook.start();
    this.windowTracker.startTracking();
  }

  stop() {
    this.keyboardHook.stop();
    this.windowTracker.stopTracking();
  }
}
```

## 4. Python FastAPI Service

```python
# python-service/app/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ollama
from typing import Optional
import time
from functools import lru_cache

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])

SYSTEM_PROMPT = """You are an expert prompt engineer. Optimize user prompts to be:
1. Clear and specific
2. Well-structured
3. Action-oriented
4. Include necessary context
5. Remove redundancy

Return ONLY the optimized prompt, no explanations."""

class OptimizeRequest(BaseModel):
    prompt: str

class OptimizeResponse(BaseModel):
    optimized: str
    original: str
    model: str = "llama3.2"
    latency_ms: Optional[float] = None

# Simple in-memory cache
@lru_cache(maxsize=100)
def cached_optimize(prompt: str) -> str:
    """This won't work with lru_cache directly, but shows concept"""
    pass

@app.post("/optimize", response_model=OptimizeResponse)
async def optimize_prompt(request: OptimizeRequest):
    start_time = time.time()
    
    if not request.prompt or len(request.prompt.strip()) < 5:
        raise HTTPException(status_code=400, detail="Prompt too short")
    
    try:
        # Check cache (simplified - use Redis or proper cache in production)
        # For now, always call Ollama
        
        response = ollama.chat(
            model="llama3.2",  # User should configure this
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Optimize this prompt: {request.prompt}"}
            ],
            options={
                "temperature": 0.7,
                "num_predict": 500
            }
        )
        
        optimized = response["message"]["content"].strip()
        
        # Clean up markdown code blocks if present
        if optimized.startswith("```"):
            lines = optimized.split("\n")
            if len(lines) > 1:
                optimized = "\n".join(lines[1:-1]) if lines[-1].startswith("```") else "\n".join(lines[1:])
        
        latency = (time.time() - start_time) * 1000
        
        return OptimizeResponse(
            optimized=optimized,
            original=request.prompt,
            latency_ms=latency
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {str(e)}")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "prompt-optimizer"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
```

## 5. Electron Main Process Orchestrator

```typescript
// electron/main/app.ts
import { app, BrowserWindow } from "electron";
import { TriggerDetector, PromptContext } from "./input/trigger-detector";
import { OverlayManager } from "./overlay/overlay-manager";
import { PythonClient } from "./api/python-client";

export class PromptOptimizerApp {
  private triggerDetector: TriggerDetector;
  private overlayManager: OverlayManager;
  private pythonClient: PythonClient;
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.triggerDetector = new TriggerDetector();
    this.overlayManager = new OverlayManager();
    this.pythonClient = new PythonClient("http://localhost:8000");
    this.setupListeners();
  }

  private setupListeners() {
    this.triggerDetector.on("prompt-captured", async (context: PromptContext) => {
      await this.handlePrompt(context);
    });
  }

  private async handlePrompt(context: PromptContext) {
    console.log("Processing prompt:", context.promptText);

    // Show loading indicator
    this.overlayManager.showHighlight(context, { loading: true });

    try {
      // Optimize prompt
      const optimized = await this.pythonClient.optimize(context.promptText);
      
      // Show overlay with optimized text
      this.overlayManager.showOptimization(
        context,
        context.promptText,
        optimized
      );
    } catch (error) {
      console.error("Failed to optimize prompt:", error);
      // Show error or fallback
      this.overlayManager.hide(context);
    }
  }

  async initialize() {
    // Check Python service is running
    const isHealthy = await this.pythonClient.healthCheck();
    if (!isHealthy) {
      console.warn("Python service not available. Some features may not work.");
    }

    // Start keyboard monitoring
    this.triggerDetector.start();

    console.log("Prompt Optimizer initialized");
  }

  async shutdown() {
    this.triggerDetector.stop();
    this.overlayManager.cleanup();
  }
}

// Electron app lifecycle
let optimizerApp: PromptOptimizerApp;

app.whenReady().then(async () => {
  optimizerApp = new PromptOptimizerApp();
  await optimizerApp.initialize();
});

app.on("before-quit", async () => {
  if (optimizerApp) {
    await optimizerApp.shutdown();
  }
});
```

## 6. Python Client (Electron Side)

```typescript
// electron/main/api/python-client.ts
import axios, { AxiosInstance } from "axios";

export class PythonClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:8000") {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 10000, // 10 second timeout
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  async optimize(prompt: string): Promise<string> {
    try {
      const response = await this.client.post("/optimize", { prompt });
      return response.data.optimized;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Optimization failed: ${error.message}`);
      }
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get("/health");
      return response.data.status === "ok";
    } catch (error) {
      return false;
    }
  }
}
```

## 7. Overlay Manager

```typescript
// electron/main/overlay/overlay-manager.ts
import { BrowserWindow, screen } from "electron";
import { PromptContext } from "../input/trigger-detector";
import path from "path";

interface HighlightOptions {
  loading?: boolean;
}

export class OverlayManager {
  private highlights: Map<string, BrowserWindow> = new Map();
  private popups: Map<string, BrowserWindow> = new Map();

  showHighlight(context: PromptContext, options: HighlightOptions = {}) {
    const key = this.getContextKey(context);
    
    // Remove existing highlight if any
    this.hideHighlight(context);

    const highlight = new BrowserWindow({
      width: 200,
      height: 30,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Position over the prompt text
    const { x, y } = this.calculateHighlightPosition(context);
    highlight.setPosition(x, y);

    highlight.loadFile(path.join(__dirname, "../renderer/highlight.html"), {
      query: { loading: options.loading ? "true" : "false" }
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
    if (highlight) {
      highlight.webContents.send("update-state", { ready: true });
    }

    // Create popup
    const popup = new BrowserWindow({
      width: 500,
      height: 300,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "../preload.js")
      }
    });

    const { x, y } = this.calculatePopupPosition(context);
    popup.setPosition(x, y);

    popup.loadFile(path.join(__dirname, "../renderer/popup.html"), {
      query: {
        original: encodeURIComponent(original),
        optimized: encodeURIComponent(optimized)
      }
    });

    // Handle replace action
    popup.webContents.on("ipc-message", (event, channel, data) => {
      if (channel === "replace-text") {
        this.handleReplace(context, data.text);
        this.hide(context);
      }
    });

    this.popups.set(key, popup);
  }

  private calculateHighlightPosition(context: PromptContext): { x: number; y: number } {
    // Simplified - in reality, need better cursor position estimation
    return {
      x: context.estimatedCursorX,
      y: context.estimatedCursorY - 25
    };
  }

  private calculatePopupPosition(context: PromptContext): { x: number; y: number } {
    // Position popup above the highlight
    return {
      x: context.estimatedCursorX,
      y: context.estimatedCursorY - 320
    };
  }

  private getContextKey(context: PromptContext): string {
    return `${context.window.handle}-${context.timestamp}`;
  }

  hide(context: PromptContext) {
    this.hideHighlight(context);
    this.hidePopup(context);
  }

  private hideHighlight(context: PromptContext) {
    const key = this.getContextKey(context);
    const highlight = this.highlights.get(key);
    if (highlight) {
      highlight.close();
      this.highlights.delete(key);
    }
  }

  private hidePopup(context: PromptContext) {
    const key = this.getContextKey(context);
    const popup = this.popups.get(key);
    if (popup) {
      popup.close();
      this.popups.delete(key);
    }
  }

  cleanup() {
    this.highlights.forEach(win => win.close());
    this.popups.forEach(win => win.close());
    this.highlights.clear();
    this.popups.clear();
  }

  private async handleReplace(context: PromptContext, newText: string) {
    // Implement text replacement logic
    // This is complex and platform-specific
    console.log("Replacing text:", newText);
    // Would use native modules or clipboard + keyboard simulation
  }
}
```

## Usage Notes

1. **Install Dependencies**:
   ```bash
   # Electron
   npm install node-global-key-listener axios
   
   # Python
   pip install fastapi uvicorn ollama
   ```

2. **Start Python Service**:
   ```bash
   cd python-service
   uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

3. **Run Electron App**:
   ```bash
   npm run electron
   ```

4. **Test**: Type "@prompt your text here" in any application.

These examples provide a concrete starting point for implementation. Adjust based on your specific needs and platform requirements.

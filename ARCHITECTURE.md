# Global Prompt Optimization Desktop App - System Architecture

## 1. SYSTEM ARCHITECTURE

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    OS Layer (Windows/macOS)                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Global Keyboard Hook (Native Module)         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              Electron Main Process (TypeScript)              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Input Monitor   │  │  Overlay Manager │                │
│  │  - Detect @prompt│  │  - Render UI     │                │
│  │  - Track context │  │  - Position calc │                │
│  └──────────────────┘  └──────────────────┘                │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Context Tracker │  │  Text Replacer   │                │
│  │  - Window info   │  │  - Send keys     │                │
│  │  - Cursor pos    │  │  - Clipboard     │                │
│  └──────────────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
                            ↓ IPC/HTTP
┌─────────────────────────────────────────────────────────────┐
│              Python AI Service (FastAPI/Flask)                │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Prompt Processor│  │  Ollama Client   │                │
│  │  - Preprocessing │  │  - Model calls   │                │
│  │  - Validation    │  │  - Streaming     │                │
│  └──────────────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP
┌─────────────────────────────────────────────────────────────┐
│                    Ollama (Local LLM)                        │
│              - LLaMA / Mistral / etc.                        │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### **Electron Main Process (TypeScript)**
- **Input Monitor**: Captures global keyboard events, detects "@prompt" trigger
- **Context Tracker**: Maintains state of active window, cursor position, text field bounds
- **Overlay Manager**: Creates/manages transparent overlay windows for UI elements
- **Text Replacer**: Handles safe text replacement via simulated keyboard input or clipboard
- **IPC Bridge**: Communicates with Python service via HTTP/WebSocket

#### **Python AI Service**
- **Prompt Processor**: Validates, preprocesses, and sanitizes user prompts
- **Ollama Client**: Manages connection to local Ollama instance, handles model inference
- **Response Handler**: Post-processes LLM output, extracts optimized prompt
- **API Server**: Exposes REST/WebSocket endpoints for Electron

#### **Ollama (External)**
- Local LLM runtime (assumed pre-installed)
- Handles model loading and inference

### Communication Flow

```
Keyboard Event → Native Hook → Electron Main → Context Analysis
                                                      ↓
Python Service ← HTTP Request ← Prompt Text ← Extract Text
     ↓
Ollama API Call
     ↓
Optimized Prompt → Electron Main → Overlay UI → User Interaction
```

---

## 2. GLOBAL INPUT DETECTION

### OS-Specific Approaches

#### **Windows**

**Library**: `node-global-key-listener` or native Node.js addon using Windows API

**Key APIs**:
- `SetWindowsHookEx(WH_KEYBOARD_LL, ...)` - Low-level keyboard hook
- `GetAsyncKeyState()` - Check modifier keys (Ctrl, Shift, etc.)
- `GetForegroundWindow()` - Identify active window
- `GetWindowThreadProcessId()` - Get process info

**Implementation Strategy**:
```typescript
// Native addon (C++/Node-API) or use node-global-key-listener
import { GlobalKeyboardListener } from "node-global-key-listener";

const listener = new GlobalKeyboardListener();
let buffer = "";
let isCapturing = false;

listener.addListener((e, down) => {
  if (down && e.name === "@") {
    isCapturing = true;
    buffer = "@";
    return;
  }
  
  if (isCapturing) {
    if (e.name === "SPACE" && buffer === "@prompt") {
      // Trigger detected, start capturing prompt text
      startPromptCapture();
    } else if (e.name.length === 1) {
      buffer += e.name.toLowerCase();
      // Reset if not matching "@prompt"
      if (!"@prompt".startsWith(buffer)) {
        isCapturing = false;
        buffer = "";
      }
    }
  }
});
```

**Challenges**:
- Windows requires admin privileges for global hooks (or use `WH_KEYBOARD_LL` which doesn't)
- Need to handle international keyboards (key codes vs characters)
- Must distinguish between "@" typed vs "@" in clipboard paste

#### **macOS**

**Library**: `iohook` or native addon using `CGEventTap`

**Key APIs**:
- `CGEventTapCreate()` - Create event tap
- `CGEventGetIntegerValueField()` - Extract key codes
- `CGEventSourceKeyState()` - Check modifier keys
- `CGWindowListCopyWindowInfo()` - Get window information

**Implementation Strategy**:
```typescript
// Using iohook or native addon
import { ioHook } from "iohook";

ioHook.on("keydown", (event) => {
  const char = String.fromCharCode(event.rawcode);
  // Similar detection logic as Windows
});
```

**Challenges**:
- macOS requires Accessibility permissions (user must grant in System Preferences)
- `CGEventTap` requires running as root or with accessibility permissions
- Event taps can be disabled by system if app is slow

### Detection Reliability

**Trigger Pattern**: `@prompt ` (with space after)

**Detection Algorithm**:
1. Monitor for "@" key press
2. Buffer next 6 characters
3. If buffer matches "prompt" + space, trigger capture mode
4. Continue capturing until:
   - User presses Enter
   - User clicks elsewhere
   - Timeout (5 seconds)
   - User types "@prompt" again (reset)

**Edge Cases**:
- User types "@prompt" in password field → Ignore
- User types "@prompt" in terminal → May need special handling
- User pastes text containing "@prompt" → Detect via clipboard monitoring
- Multiple "@prompt" instances → Track each separately

---

## 3. TEXT CONTEXT & CURSOR HANDLING

### Window and Text Field Identification

#### **Windows API Approach**

```typescript
import { exec } from "child_process";
import { promisify } from "util";

// Get active window info
async function getActiveWindowInfo(): Promise<WindowInfo> {
  // Use PowerShell or native module
  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32 {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
      }
      public struct RECT { public int Left, Top, Right, Bottom; }
"@
    $hwnd = [Win32]::GetForegroundWindow()
    $rect = New-Object RECT
    [Win32]::GetWindowRect($hwnd, [ref]$rect)
    $title = New-Object System.Text.StringBuilder 256
    [Win32]::GetWindowText($hwnd, $title, 256)
    Write-Output "$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)|$($title.ToString())"
  `;
  
  // Execute and parse
}
```

#### **macOS Approach**

```typescript
// Use AppleScript or native APIs
const script = `
  tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
    set frontWindow to window 1 of process frontApp
    set windowPosition to position of frontWindow
    set windowSize to size of frontWindow
  end tell
`;
```

### Cursor Position Detection

**Challenge**: No universal API to get text cursor position across all apps.

**Solutions**:

1. **Screen Coordinate Estimation** (Fallback):
   - Track approximate position based on:
     - Window bounds
     - Font size estimation (default 12-14px)
     - Character count from "@prompt" to cursor
   - Inaccurate but works for overlay positioning

2. **Application-Specific Hooks** (Advanced):
   - Inject into specific apps (Chrome, VS Code, etc.)
   - Use accessibility APIs to query cursor position
   - **Windows**: `IAccessible` interface
   - **macOS**: `AXUIElement` API

3. **OCR + ML Approach** (Future):
   - Screenshot text field area
   - OCR to find "@prompt" location
   - Calculate relative cursor position

**MVP Approach**: Use screen coordinates with reasonable assumptions.

```typescript
interface TextContext {
  windowHandle: string;
  windowTitle: string;
  windowBounds: { x: number; y: number; width: number; height: number };
  estimatedCursorX: number;
  estimatedCursorY: number;
  promptStartOffset: number; // Characters from start of text field
  promptText: string;
  fontSize: number; // Estimated
}
```

### Handling Focus Changes

**State Management**:
```typescript
class ContextTracker {
  private activeContext: TextContext | null = null;
  private promptInstances: Map<string, PromptInstance> = new Map();
  
  onWindowFocusChange() {
    // Clear old context if window changed
    if (this.activeContext?.windowHandle !== currentWindow) {
      this.clearOverlays();
      this.activeContext = null;
    }
  }
  
  onCursorMove() {
    // Update cursor position estimate
    // Reposition overlay if needed
  }
}
```

---

## 4. UI OVERLAY SYSTEM

### Electron Overlay Window

**Window Configuration**:
```typescript
import { BrowserWindow } from "electron";

function createOverlayWindow(): BrowserWindow {
  const overlay = new BrowserWindow({
    width: 400,
    height: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js")
    }
  });
  
  overlay.setIgnoreMouseEvents(true, { forward: true }); // Forward clicks to underlying app
  overlay.loadFile("overlay.html");
  return overlay;
}
```

### Inline Highlighting

**Approach**: Render semi-transparent colored rectangle over text

```typescript
// overlay.html
<div id="highlight" class="highlight-rect"></div>

<style>
  .highlight-rect {
    position: absolute;
    background: rgba(100, 200, 255, 0.3);
    border-bottom: 2px solid #64C8FF;
    pointer-events: none;
    z-index: 999999;
  }
</style>
```

**Positioning**:
```typescript
function positionHighlight(context: TextContext) {
  const highlight = document.getElementById("highlight");
  const screenX = context.windowBounds.x + context.estimatedCursorX;
  const screenY = context.windowBounds.y + context.estimatedCursorY;
  
  // Calculate width based on text length
  const charWidth = context.fontSize * 0.6; // Approximate
  const width = context.promptText.length * charWidth;
  
  highlight.style.left = `${screenX}px`;
  highlight.style.top = `${screenY - context.fontSize}px`;
  highlight.style.width = `${width}px`;
  highlight.style.height = `${context.fontSize * 1.2}px`;
}
```

### Hover Tooltip/Popup

**Implementation**:
```typescript
// Show popup on mouse hover over highlight
let popupWindow: BrowserWindow | null = null;

function showOptimizationPopup(optimizedText: string, context: TextContext) {
  if (popupWindow) return;
  
  popupWindow = new BrowserWindow({
    width: 500,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true }
  });
  
  // Position above/below highlight
  const popupX = context.windowBounds.x + context.estimatedCursorX;
  const popupY = context.windowBounds.y + context.estimatedCursorY - 320;
  
  popupWindow.setPosition(popupX, popupY);
  popupWindow.loadFile("popup.html", { query: { text: optimizedText } });
  
  // Make clickable
  popupWindow.setIgnoreMouseEvents(false);
}
```

**Popup UI** (popup.html):
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 15px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .original { color: #666; font-size: 12px; margin-bottom: 10px; }
    .optimized { color: #333; font-size: 14px; line-height: 1.5; }
    .button {
      margin-top: 15px;
      padding: 8px 16px;
      background: #007AFF;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="original">Original: <span id="original"></span></div>
  <div class="optimized" id="optimized"></div>
  <button class="button" id="replace-btn">Replace</button>
  
  <script>
    const params = new URLSearchParams(window.location.search);
    document.getElementById("optimized").textContent = params.get("text");
    document.getElementById("replace-btn").onclick = () => {
      window.electronAPI.replaceText(params.get("text"));
    };
  </script>
</body>
</html>
```

### Click-to-Replace Implementation

**Strategy**: Simulate keyboard input to replace text

```typescript
// Windows: Use SendInput API
import { exec } from "child_process";

async function replaceText(originalText: string, newText: string) {
  // 1. Select original text
  // Send Shift+Home or Shift+Arrow keys to select
  await sendKeys(["Shift", "Home"]); // Select to start of line/field
  
  // 2. Type new text (will replace selection)
  await typeText(newText);
  
  // Alternative: Use clipboard
  // 1. Copy newText to clipboard
  // 2. Send Ctrl+V
}

// macOS: Use AppleScript or CGEvent
async function sendKeys(keys: string[]) {
  // Use native module or AppleScript
}
```

**Safety Considerations**:
- Verify text field is still focused
- Confirm original text still matches (user may have edited)
- Add undo support (store original, allow Ctrl+Z)

---

## 5. AI PROMPT OPTIMIZATION PIPELINE

### Python Service Architecture

**Framework**: FastAPI (async, WebSocket support)

```python
# main.py
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import ollama
import asyncio

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])

# System prompt for optimization
SYSTEM_PROMPT = """You are an expert prompt engineer. Your task is to optimize user prompts to be:
1. Clear and specific
2. Well-structured with proper formatting
3. Action-oriented
4. Include necessary context
5. Remove redundancy
6. Improve clarity without changing intent

Return ONLY the optimized prompt, no explanations or meta-commentary."""

@app.post("/optimize")
async def optimize_prompt(request: dict):
    user_prompt = request.get("prompt", "")
    
    if not user_prompt or len(user_prompt) < 5:
        return {"optimized": user_prompt, "error": "Prompt too short"}
    
    try:
        response = ollama.chat(
            model="llama3.2",  # or mistral, etc.
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Optimize this prompt: {user_prompt}"}
            ],
            options={
                "temperature": 0.7,
                "num_predict": 500
            }
        )
        
        optimized = response["message"]["content"].strip()
        
        # Sanitize: Remove markdown code blocks if present
        if optimized.startswith("```"):
            optimized = optimized.split("```")[1]
            if optimized.startswith("\n"):
                optimized = optimized[1:]
        
        return {
            "optimized": optimized,
            "original": user_prompt,
            "model": "llama3.2"
        }
        
    except Exception as e:
        return {"error": str(e), "optimized": user_prompt}

@app.websocket("/optimize-stream")
async def optimize_stream(websocket: WebSocket):
    await websocket.accept()
    data = await websocket.receive_json()
    
    # Stream response from Ollama
    stream = ollama.chat(
        model="llama3.2",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Optimize: {data['prompt']}"}
        ],
        stream=True
    )
    
    for chunk in stream:
        if chunk.get("message"):
            await websocket.send_json({
                "chunk": chunk["message"]["content"]
            })
```

### Enhanced System Prompt

```python
SYSTEM_PROMPT = """You are a professional prompt optimization assistant. Your goal is to improve user prompts for AI interactions.

Guidelines:
- Maintain the user's original intent
- Make prompts more specific and actionable
- Add structure (use formatting, lists, clear sections)
- Remove ambiguity
- Ensure clarity and conciseness
- Preserve technical terms and domain-specific language
- Do NOT add content the user didn't request
- Do NOT change the core request

Output format: Return ONLY the optimized prompt text, nothing else. No explanations, no "Here's the optimized version:", just the prompt itself."""
```

### Communication Protocol

**Electron → Python**:
```typescript
async function optimizePrompt(text: string): Promise<string> {
  const response = await fetch("http://localhost:8000/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: text })
  });
  
  const data = await response.json();
  return data.optimized || text;
}
```

**Error Handling**:
- Timeout (5 seconds max)
- Fallback to original text if error
- Retry logic for transient failures
- Queue requests if Ollama is busy

### Latency Optimization

1. **Debouncing**: Wait 500ms after user stops typing before sending to AI
2. **Caching**: Cache common prompts (LRU cache, 100 entries)
3. **Streaming**: Use WebSocket for progressive display
4. **Pre-warming**: Keep Ollama model loaded in memory
5. **Request Cancellation**: Cancel if user continues typing

```typescript
class PromptOptimizer {
  private cache = new Map<string, string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  
  async optimize(text: string): Promise<string> {
    // Check cache
    if (this.cache.has(text)) {
      return this.cache.get(text)!;
    }
    
    // Debounce
    return new Promise((resolve) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      
      this.debounceTimer = setTimeout(async () => {
        try {
          const optimized = await fetchOptimize(text);
          this.cache.set(text, optimized);
          resolve(optimized);
        } catch (error) {
          resolve(text); // Fallback
        }
      }, 500);
    });
  }
}
```

---

## 6. DATA FLOW (STEP-BY-STEP)

### Complete Flow Diagram

```
1. USER TYPES: "@prompt write a blog post"
   ↓
2. GLOBAL KEYBOARD HOOK detects "@" → "p" → "r" → ... → space
   ↓
3. ELECTRON MAIN PROCESS:
   - InputMonitor detects "@prompt " trigger
   - ContextTracker captures:
     * Active window handle
     * Window bounds
     * Estimated cursor position
     * Prompt text: "write a blog post"
   ↓
4. ELECTRON sends HTTP request to Python:
   POST http://localhost:8000/optimize
   { "prompt": "write a blog post" }
   ↓
5. PYTHON SERVICE:
   - Validates prompt (length, content)
   - Checks cache (miss)
   - Calls Ollama API
   ↓
6. OLLAMA processes request:
   - Loads model (if not loaded)
   - Runs inference (~1-3 seconds)
   - Returns optimized prompt
   ↓
7. PYTHON returns response:
   { "optimized": "Write a comprehensive blog post that..." }
   ↓
8. ELECTRON receives response:
   - OverlayManager creates highlight overlay
   - Positions highlight over original text
   - Shows hover tooltip with optimized version
   ↓
9. USER hovers over highlight:
   - Popup window appears
   - Displays optimized prompt
   - "Replace" button available
   ↓
10. USER clicks "Replace":
    - TextReplacer selects original text
    - Simulates typing optimized text
    - Closes popup
    - Removes highlight
```

### Timing Considerations

- **Detection**: < 10ms (keyboard hook)
- **Context capture**: 50-100ms (window info, cursor estimation)
- **Network (IPC)**: < 5ms (localhost)
- **AI processing**: 1-5 seconds (Ollama inference)
- **UI rendering**: < 50ms (overlay creation)
- **Total latency**: 1-5.5 seconds (dominated by AI)

**User Experience**:
- Show loading indicator immediately
- Display "Optimizing..." in popup
- Stream response if using WebSocket

---

## 7. SECURITY & PRIVACY

### Data Protection

**What is Stored**:
- **Cache**: Recent prompt optimizations (in-memory, cleared on exit)
- **Settings**: User preferences (local config file)
- **Logs**: Error logs only (no prompt content)

**What is NOT Stored**:
- Prompt text (except temporary cache)
- Window titles or application names
- Screenshots or screen content
- User keystrokes (except "@prompt" trigger detection)

**Implementation**:
```typescript
// Privacy-conscious caching
class SecureCache {
  private cache = new LRUCache<string, string>({ max: 100 });
  
  // Clear on app exit
  onExit() {
    this.cache.clear();
  }
  
  // No persistence to disk
  // No telemetry
  // No cloud sync
}
```

### Permissions Required

**Windows**:
- No admin required (WH_KEYBOARD_LL works without admin)
- User may see UAC prompt on first install (if using installer)

**macOS**:
- **Accessibility**: Required for keyboard monitoring
- User must grant in System Preferences → Security & Privacy → Accessibility
- Clear explanation in installer/README

### Transparency

**Privacy Policy Points**:
1. All processing happens locally (no cloud)
2. No data leaves the device
3. Ollama runs on localhost
4. Cache is in-memory only
5. No telemetry or analytics
6. Open source (if applicable)

**Code Signing**:
- Sign Electron app for Windows (Authenticode)
- Sign for macOS (Developer ID)
- Reduces "Unknown Developer" warnings

**Anti-Spyware Measures**:
- Open source code (if possible)
- Clear privacy documentation
- No network access except localhost
- Firewall rules to block external connections

---

## 8. PERFORMANCE CONSIDERATIONS

### Avoiding Typing Lag

**Key Strategy**: Non-blocking, async processing

```typescript
// DON'T block keyboard events
listener.addListener(async (e, down) => {
  // Fast path: just detect trigger
  if (isTrigger(e)) {
    // Schedule async work, don't await
    processPromptAsync().catch(console.error);
  }
});

// Process in background
async function processPromptAsync() {
  // All heavy work here (AI calls, UI updates)
  // Doesn't block keyboard input
}
```

### Debouncing Strategy

```typescript
class DebouncedProcessor {
  private timer: NodeJS.Timeout | null = null;
  private pendingText: string = "";
  
  process(text: string) {
    this.pendingText = text;
    
    if (this.timer) {
      clearTimeout(this.timer);
    }
    
    this.timer = setTimeout(() => {
      this.optimize(this.pendingText);
      this.pendingText = "";
    }, 500); // Wait 500ms after last keystroke
  }
}
```

### Resource Management

**Memory**:
- Limit cache size (100 entries)
- Clear overlays when not needed
- Unload models if Ollama supports it (optional)

**CPU**:
- Throttle AI requests (max 1 concurrent)
- Cancel stale requests
- Use efficient native modules for hooks

**Network**:
- Localhost only (minimal overhead)
- Connection pooling for HTTP
- WebSocket for streaming (reuse connection)

### Async Architecture

```typescript
// Main process: Event-driven, non-blocking
class App {
  private inputMonitor: InputMonitor;
  private optimizer: PromptOptimizer;
  private overlayManager: OverlayManager;
  
  async initialize() {
    // All async, don't block
    await this.inputMonitor.start();
    await this.optimizer.connect();
    // App ready
  }
  
  // All handlers are async but fire-and-forget where appropriate
  onPromptDetected(text: string) {
    // Don't await, process in background
    this.handlePrompt(text).catch(console.error);
  }
}
```

---

## 9. MVP VS FUTURE ROADMAP

### MVP Features (v1.0)

**Core Functionality**:
- ✅ Global "@prompt" detection (Windows + macOS)
- ✅ Basic text capture after trigger
- ✅ HTTP communication with Python service
- ✅ Ollama integration for prompt optimization
- ✅ Simple overlay with highlight
- ✅ Hover popup showing optimized text
- ✅ Click-to-replace functionality
- ✅ English language only
- ✅ Basic error handling

**Limitations in MVP**:
- Cursor position estimation (may be inaccurate)
- Works best in standard text fields
- No undo support
- Single model (user configures Ollama model)
- No streaming (wait for full response)
- Basic UI (functional, not polished)

### Future Enhancements (v2.0+)

**Accuracy Improvements**:
- Application-specific cursor detection (Chrome, VS Code, etc.)
- OCR-based text field detection
- Better font size estimation
- Multi-monitor support improvements

**AI Features**:
- Multiple model support (user chooses)
- Prompt style presets (concise, detailed, technical, etc.)
- Custom system prompts
- Prompt templates/snippets
- History of optimizations

**UX Enhancements**:
- Keyboard shortcuts (Ctrl+Enter to accept)
- Undo/redo support
- Multiple prompt instances tracking
- Better visual design
- Animation/transitions
- Settings UI

**Advanced Features**:
- Multi-language support
- Context awareness (detect code vs prose)
- Integration with specific apps (VS Code extension companion)
- Cloud sync (optional, user choice)
- Team/organization features

---

## 10. DEVELOPMENT PLAN

### Phase 1: Foundation (Week 1-2)

**Goals**: Basic Electron app + keyboard detection

**Tasks**:
1. Set up Electron + TypeScript project
2. Implement global keyboard hook (Windows first)
3. Test "@prompt" detection in Notepad
4. Add basic logging/debugging
5. Create window context tracking (basic)

**Deliverable**: App detects "@prompt" and logs to console

**Folder Structure**:
```
prompt-optimizer/
├── electron/
│   ├── main/
│   │   ├── main.ts          # Electron main process
│   │   ├── input-monitor.ts # Keyboard hook
│   │   ├── context-tracker.ts
│   │   └── overlay-manager.ts
│   ├── renderer/
│   │   ├── overlay.html
│   │   └── popup.html
│   └── preload.ts
├── python-service/
│   ├── main.py              # FastAPI server
│   ├── ollama_client.py
│   └── requirements.txt
├── native/                  # Optional: native modules
│   └── keyboard-hook/       # C++ addon for Windows/macOS
├── package.json
└── README.md
```

### Phase 2: Python Service (Week 2-3)

**Goals**: Working AI optimization pipeline

**Tasks**:
1. Set up FastAPI service
2. Integrate Ollama client
3. Create system prompt
4. Test with sample prompts
5. Add error handling
6. Implement caching

**Deliverable**: HTTP endpoint that returns optimized prompts

**Mocking**: Can mock Ollama responses initially for testing

### Phase 3: UI Overlays (Week 3-4)

**Goals**: Visual feedback and interaction

**Tasks**:
1. Create transparent overlay window
2. Implement highlight rendering
3. Add popup window
4. Position calculation logic
5. Click-to-replace (basic)
6. Test in multiple apps

**Deliverable**: Visual highlight + popup working

### Phase 4: Integration (Week 4-5)

**Goals**: End-to-end flow

**Tasks**:
1. Connect Electron → Python
2. Full flow: detection → AI → UI → replace
3. Error handling and edge cases
4. Performance optimization
5. Cross-app testing

**Deliverable**: Working MVP

### Phase 5: Polish & macOS (Week 5-6)

**Goals**: macOS support + refinement

**Tasks**:
1. Implement macOS keyboard hook
2. Test on macOS
3. UI polish
4. Error messages
5. Installation/setup docs
6. Basic settings

**Deliverable**: Cross-platform MVP

### Phase 6: Distribution (Week 6-7)

**Goals**: Commercial-ready package

**Tasks**:
1. Code signing
2. Installer creation (Windows: NSIS/Inno, macOS: DMG)
3. Auto-updater setup (electron-updater)
4. Privacy policy
5. User documentation
6. Beta testing

**Deliverable**: Installable, distributable app

### Suggested Folder Structure (Detailed)

```
prompt-optimizer/
├── electron/
│   ├── main/
│   │   ├── index.ts                 # Entry point
│   │   ├── app.ts                   # App lifecycle
│   │   ├── input/
│   │   │   ├── keyboard-hook.ts     # Global keyboard listener
│   │   │   └── trigger-detector.ts # "@prompt" detection
│   │   ├── context/
│   │   │   ├── window-tracker.ts   # Active window info
│   │   │   └── cursor-estimator.ts # Cursor position logic
│   │   ├── overlay/
│   │   │   ├── overlay-manager.ts  # Overlay window management
│   │   │   ├── highlight-renderer.ts
│   │   │   └── popup-renderer.ts
│   │   ├── text/
│   │   │   └── text-replacer.ts    # Replacement logic
│   │   └── api/
│   │       └── python-client.ts    # HTTP client for Python
│   ├── renderer/
│   │   ├── overlay.html
│   │   ├── overlay.js
│   │   ├── popup.html
│   │   └── popup.js
│   ├── preload.ts
│   └── package.json
├── python-service/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                 # FastAPI app
│   │   ├── routes/
│   │   │   └── optimize.py         # /optimize endpoint
│   │   ├── services/
│   │   │   ├── ollama_service.py   # Ollama client
│   │   │   └── cache.py            # Caching logic
│   │   └── prompts/
│   │       └── system_prompt.py    # System prompt template
│   ├── requirements.txt
│   └── README.md
├── native/                          # Optional native modules
│   ├── keyboard-hook-win/
│   │   ├── binding.gyp
│   │   ├── keyboard-hook.cc
│   │   └── package.json
│   └── keyboard-hook-mac/
│       └── ...
├── scripts/
│   ├── build.js                    # Build scripts
│   └── package.js                  # Packaging
├── resources/
│   ├── icons/
│   └── installer/
├── tests/
│   ├── electron/
│   └── python/
├── docs/
│   ├── ARCHITECTURE.md             # This file
│   ├── SETUP.md
│   └── PRIVACY.md
├── package.json                    # Root package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

### Initial Setup Commands

```bash
# Root
npm init -y
npm install electron electron-builder --save-dev
npm install typescript @types/node --save-dev

# Electron main
cd electron
npm install node-global-key-listener  # or native alternative
npm install axios                     # HTTP client

# Python service
cd python-service
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install fastapi uvicorn ollama
```

### What to Mock Initially

1. **Ollama**: Return hardcoded optimized prompts
2. **Cursor Position**: Use fixed offsets
3. **Window Info**: Mock window bounds
4. **Text Replacement**: Log to console instead of actual replacement

This allows testing each component independently.

---

## TECHNICAL CHALLENGES & SOLUTIONS

### Challenge 1: Accurate Cursor Position

**Problem**: No universal API for text cursor position.

**Solutions**:
- **MVP**: Estimation based on character count and font size
- **Future**: App-specific hooks, accessibility APIs, OCR

### Challenge 2: Text Replacement Safety

**Problem**: Simulating keyboard input can be unreliable.

**Solutions**:
- Use clipboard as fallback
- Verify context before replacement
- Support undo (store original text)

### Challenge 3: Performance with Global Hooks

**Problem**: Global hooks can slow down system if not optimized.

**Solutions**:
- Minimal processing in hook callback
- Defer heavy work to async tasks
- Use efficient native modules

### Challenge 4: Cross-Platform Consistency

**Problem**: Windows and macOS have different APIs.

**Solutions**:
- Abstract platform-specific code
- Use libraries that support both (if available)
- Platform-specific implementations with common interface

### Challenge 5: Ollama Latency

**Problem**: Local LLM inference can be slow (1-5 seconds).

**Solutions**:
- Show loading state immediately
- Debounce requests
- Cache common prompts
- Consider smaller/faster models for MVP

---

## CONCLUSION

This architecture provides a complete, realistic blueprint for building a global prompt optimization desktop application. The design addresses:

- ✅ Global input detection across OS
- ✅ Text context and cursor handling
- ✅ UI overlay system
- ✅ AI integration with local LLM
- ✅ Security and privacy considerations
- ✅ Performance optimization
- ✅ MVP scope and future roadmap
- ✅ Step-by-step development plan

**Key Success Factors**:
1. Start with MVP (basic functionality)
2. Test extensively across different applications
3. Optimize for performance (non-blocking, async)
4. Be transparent about privacy
5. Iterate based on user feedback

**Next Steps**:
1. Set up project structure
2. Implement Phase 1 (keyboard detection)
3. Test in real applications
4. Iterate and refine

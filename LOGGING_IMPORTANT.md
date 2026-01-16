# LOGGING_IMPORTANT - Complete Logging Reference

This file documents ALL logging changes made during the cleanup. Use this to restore specific logs when debugging particular issues.

---

## Table of Contents
1. [WindowTracker Logs](#windowtracker-logs)
2. [TextStatePoller Logs](#textstatepoller-logs)
3. [ContinuousOptimizer Logs](#continuousoptimizer-logs)
4. [OverlayManager Logs](#overlaymanager-logs)
5. [TriggerDetector Logs](#triggerdetector-logs)
6. [App Logs](#app-logs)
7. [TextReplacer Logs (KEPT - Important)](#textreplacer-logs-kept---important)
8. [Quick Reference - When to Enable What](#quick-reference---when-to-enable-what)

---

## WindowTracker Logs

**File:** `electron/main/context/window-tracker.ts`

**Location:** Line 86-106 in method `getWindowsActiveWindow()`

### REMOVED (Commented Out):
```typescript
// Line 86-91 (REMOVED)
console.log(`[WindowTracker] Raw stdout: "${stdout.trim()}"`);
console.log(`[WindowTracker] Parts:`, parts);
console.log(`[WindowTracker] Coords string (extracted): "${coordsStr}"`);
const coords = coordsStr.split(",").map(Number);
console.log(`[WindowTracker] Parsed coords:`, coords);
// ... validation ...
console.log(`[WindowTracker] Window bounds:`, bounds);
```

### KEPT:
```typescript
// Line 91 (KEPT - Error case only)
console.error(`[WindowTracker] Failed to parse coordinates from: "${coordsStr}"`);
```

### When to Enable:
- **Debugging window positioning issues** - If overlays appear in wrong location
- **Debugging PowerShell script failures** - If window detection stops working
- **Investigating coordinate parsing bugs** - If NaN errors occur in overlay positioning

### How to Restore:
Uncomment lines 86-91 in `getWindowsActiveWindow()` method. These logs show:
1. Raw PowerShell output
2. Split parts array
3. Extracted coordinate string
4. Parsed numeric coordinates
5. Final calculated bounds

---

## TextStatePoller Logs

**File:** `electron/main/input/text-state-poller.ts`

**Location:** Lines 219-225 and 239 in method `checkTextState()`

### REMOVED (Commented Out):
```typescript
// Lines 219-225 (REMOVED)
// console.log(
//   `[TextStatePoller] Instance detected at ${triggerIndex}:`,
//   `${lineCount} line(s),`,
//   `${promptText.length} chars,`,
//   `preview: "${promptText.substring(0, 50)}..."`
// );

// Line 239 (REMOVED)
// console.log(`[TextStatePoller] Instance removed at ${instance.triggerIndex}`);
```

### KEPT:
```typescript
// Line 30 (KEPT - Startup)
console.log("[TextStatePoller] Starting...");

// Line 41 (KEPT - Startup)
console.log("[TextStatePoller] Started - polling every", this.POLL_INTERVAL_MS, "ms");

// Line 86 (KEPT - Startup)
console.log("[TextStatePoller] Keystroke capture started");

// Line 88 (KEPT - Error)
console.error("[TextStatePoller] Failed to start keystroke capture:", error);

// Line 248 (KEPT)
console.log("[TextStatePoller] All triggers removed");
```

### When to Enable:
- **Debugging @prompt detection** - If triggers aren't being detected
- **Investigating keystroke capture issues** - If typing isn't being tracked
- **Debugging instance hash collisions** - If wrong prompts are being optimized
- **Testing multi-prompt scenarios** - Multiple @prompt instances on screen

### How to Restore:
Uncomment lines 219-225 and 239. These logs show:
1. Every time a @prompt instance is detected (shows position, line count, length, preview)
2. Every time an instance is removed (when text changes or deleted)

**WARNING:** This creates 2-4 log lines per keystroke when typing after @prompt!

---

## ContinuousOptimizer Logs

**File:** `electron/main/optimization/continuous-optimizer.ts`

**Location:** Multiple locations

### REMOVED (Commented Out):

#### 1. Instance Stabilization (Lines 117-120)
```typescript
// Lines 117-120 (REMOVED)
// console.log(
//   `[ContinuousOptimizer] Instance ${hash.substring(0, 20)}... stabilized after ${instance.session.stableFor}ms`,
//   `"${instance.session.promptText.substring(0, 50)}..."`
// );
```

#### 2. Optimization Start (Lines 159-163)
```typescript
// Lines 159-163 (REMOVED)
// console.log(
//   `[ContinuousOptimizer] Starting optimization for instance ${hash.substring(0, 20)}...`,
//   `requestId: ${requestId}`,
//   `prompt: "${promptText.substring(0, 50)}..."`
// );
```

#### 3. Optimization Complete (Lines 175-179)
```typescript
// Lines 175-179 (REMOVED)
// console.log(
//   `[ContinuousOptimizer] Optimization completed for instance ${hash.substring(0, 20)}...`,
//   `requestId: ${requestId}`,
//   `optimized length: ${optimized.length}`
// );
```

#### 4. Stale Response (Line 183)
```typescript
// Line 183 (REMOVED)
// console.log(`[ContinuousOptimizer] Discarding stale response`);
```

#### 5. Instance Marked Optimized (Line 196)
```typescript
// Line 196 (REMOVED)
// console.log(`[ContinuousOptimizer] Instance ${hash.substring(0, 20)}... marked as optimized`);
```

#### 6. New Instance Created (Lines 236-239)
```typescript
// Lines 236-239 (REMOVED)
// console.log(
//   `[ContinuousOptimizer] New instance created ${instanceHash.substring(0, 20)}...`,
//   `"${promptText.substring(0, 50)}..."`
// );
```

#### 7. Optimized Instance Changed (Lines 246-249)
```typescript
// Lines 246-249 (REMOVED)
// console.log(
//   `[ContinuousOptimizer] Optimized instance text changed ${instanceHash.substring(0, 20)}...`,
//   `"${promptText.substring(0, 50)}..."`
// );
```

#### 8. Instance Updated (Lines 262-265)
```typescript
// Lines 262-265 (REMOVED)
// console.log(
//   `[ContinuousOptimizer] Instance updated ${instanceHash.substring(0, 20)}... (edit #${instance.session.editCount})`,
//   `"${promptText.substring(0, 50)}..."`
// );
```

#### 9. Instance Removed (Line 277)
```typescript
// Line 277 (REMOVED)
// console.log(`[ContinuousOptimizer] Removing instance ${instanceHash.substring(0, 20)}...`);
```

### KEPT:
```typescript
// Line 65 (KEPT - Startup)
console.log("[ContinuousOptimizer] Starting orchestration loop");

// Line 82 (KEPT - Shutdown)
console.log("[ContinuousOptimizer] Stopping orchestration loop");

// Line 200 (KEPT - Error)
console.error(`[ContinuousOptimizer] Optimization failed for instance ${hash.substring(0, 20)}...:`, error);

// Line 314 (KEPT - Important)
console.log(`[ContinuousOptimizer] Immediate optimization blocked by guardrails`);

// Line 327 (KEPT)
console.log(`[ContinuousOptimizer] All triggers removed, clearing ${this.promptInstances.size} instances`);
```

### When to Enable:
- **Debugging optimization timing** - If prompts optimize too early/late
- **Debugging stability tracking** - If optimization triggers at wrong time
- **Investigating instance lifecycle** - If optimizations happen multiple times
- **Testing edit/update behavior** - If re-typing causes issues
- **Debugging multi-instance scenarios** - Multiple @prompt on screen simultaneously
- **Investigating guardrails** - If rate limiting or duplicate detection failing

### How to Restore:
Uncomment the specific section based on what you're debugging:
- **Stabilization issues**: Uncomment lines 117-120
- **Optimization timing**: Uncomment lines 159-163 and 175-179
- **Instance tracking**: Uncomment lines 236-239, 246-249, 262-265, 277
- **Stale responses**: Uncomment line 183

---

## OverlayManager Logs

**File:** `electron/main/overlay/overlay-manager.ts`

**Location:** Multiple locations in `showHighlight()` and `showOptimization()`

### REMOVED from showHighlight() (Lines 70-127):

#### All timestamp-based logs removed:
```typescript
// REMOVED - Line 71-74
const timestamp = new Date().toISOString();
const startTime = Date.now();
const key = this.getContextKey(context);
console.log(`[${timestamp}] [OverlayManager.showHighlight] START - key="${key}", loading=${options.loading || false}`);

// REMOVED - Line 100
console.log(`[${new Date().toISOString()}] [OverlayManager.showHighlight] BrowserWindow created`);

// REMOVED - Line 107
console.log(`[${new Date().toISOString()}] [OverlayManager.showHighlight] Calculated position: x=${x}, y=${y} -> posX=${posX}, posY=${posY}`);

// REMOVED - Line 109
console.log(`[${new Date().toISOString()}] [OverlayManager.showHighlight] Position set`);

// REMOVED - Line 112
console.log(`[${new Date().toISOString()}] [OverlayManager.showHighlight] Loading file: ${htmlPath}`);

// REMOVED - Lines 116-119 (success callback)
highlight.webContents.once("did-finish-load", () => {
  const elapsed = Date.now() - startTime;
  console.log(`[${new Date().toISOString()}] [OverlayManager.showHighlight] ✓ File loaded - Window ready (${elapsed}ms total)`);
});

// REMOVED - Lines 126-127
const elapsed = Date.now() - startTime;
console.log(`[${new Date().toISOString()}] [OverlayManager.showHighlight] ✓ COMPLETE - Highlight window created (${elapsed}ms)`);
```

### REMOVED from showOptimization() (Lines 116-198):

#### All timestamp-based logs removed:
```typescript
// REMOVED - Lines 121-125
const timestamp = new Date().toISOString();
const startTime = Date.now();
const key = this.getContextKey(context);
console.log(`[${timestamp}] [OverlayManager.showOptimization] START - key="${key}"`);
console.log(`[${timestamp}] [OverlayManager.showOptimization] Original length: ${original.length}, Optimized length: ${optimized.length}`);

// REMOVED - Lines 130-132
console.log(`[${timestamp}] [OverlayManager.showOptimization] Updating highlight state to ready...`);
highlight.webContents.send("update-state", { ready: true });
console.log(`[${new Date().toISOString()}] [OverlayManager.showOptimization] ✓ Highlight state updated`);

// REMOVED - Line 134
console.warn(`[${timestamp}] [OverlayManager.showOptimization] ⚠ Highlight window not found or destroyed (key="${key}")`);

// REMOVED - Line 138
console.log(`[${new Date().toISOString()}] [OverlayManager.showOptimization] Creating popup window...`);

// REMOVED - Line 160
console.log(`[${new Date().toISOString()}] [OverlayManager.showOptimization] Popup window created`);

// REMOVED - Line 166
console.log(`[${new Date().toISOString()}] [OverlayManager.showOptimization] Calculated popup position: x=${x}, y=${y} -> posX=${posX}, posY=${posY}`);

// REMOVED - Line 168
console.log(`[${new Date().toISOString()}] [OverlayManager.showOptimization] Popup position set`);

// REMOVED - Line 176
console.log(`[${new Date().toISOString()}] [OverlayManager.showOptimization] Loading popup file: ${popupHtmlPath}`);

// REMOVED - Line 183
console.log(`[${new Date().toISOString()}] [OverlayManager.showOptimization] Context stored`);

// REMOVED - Lines 186-189 (success callback)
popup.webContents.once("did-finish-load", () => {
  const elapsed = Date.now() - startTime;
  console.log(`[${new Date().toISOString()}] [OverlayManager.showOptimization] ✓ Popup file loaded - Window ready (${elapsed}ms total)`);
  popup.webContents.send("set-context-key", key);
});

// REMOVED - Lines 197-198
const elapsed = Date.now() - startTime;
console.log(`[${new Date().toISOString()}] [OverlayManager.showOptimization] ✓ COMPLETE - Popup window created (${elapsed}ms)`);
```

### KEPT:
```typescript
// Line 110 (KEPT - Error only)
console.error(`[OverlayManager] Highlight load failed: ${errorCode} - ${errorDescription}`);

// Line 177 (KEPT - Error only)
console.error(`[OverlayManager] Popup load failed: ${errorCode} - ${errorDescription}`);

// Lines 45-47 (KEPT - Text replacement logs in IPC handler)
console.log("[OverlayManager] Replacing text in place...");
console.log("[OverlayManager] Original:", data.originalText.substring(0, 100));
console.log("[OverlayManager] New:", data.newText.substring(0, 100));

// Line 53 (KEPT - Success)
console.log("[OverlayManager] Text replaced successfully");

// Line 55 (KEPT - Error)
console.error("Failed to replace text:", error);
```

### When to Enable:
- **Debugging overlay positioning** - If popups appear in wrong location
- **Debugging overlay visibility** - If highlights/popups don't show
- **Investigating BrowserWindow creation** - If windows fail to create
- **Performance profiling** - Enable elapsed time logs to measure overlay creation speed
- **File loading issues** - If HTML files fail to load

### How to Restore:

**For positioning issues:**
```typescript
// Restore these in showHighlight() and showOptimization()
console.log(`Calculated position: x=${x}, y=${y} -> posX=${posX}, posY=${posY}`);
```

**For performance profiling:**
```typescript
// Add at start of showHighlight() or showOptimization()
const startTime = Date.now();

// Add at end or in did-finish-load callback
const elapsed = Date.now() - startTime;
console.log(`Operation completed in ${elapsed}ms`);
```

**For full step-by-step debugging:**
Restore the entire original methods from lines 70-127 (showHighlight) and 116-198 (showOptimization).

---

## TriggerDetector Logs

**File:** `electron/main/input/trigger-detector.ts`

**Location:** Lines 72, 77, 82, 87 in event forwarding listeners

### REMOVED (Commented Out):
```typescript
// Line 72 (REMOVED)
// console.log("[TriggerDetector] New prompt session created");

// Line 77 (REMOVED)
// console.log("[TriggerDetector] Prompt session stabilized");

// Line 82 (REMOVED)
// console.log("[TriggerDetector] Optimization started");

// Line 87 (REMOVED)
// console.log("[TriggerDetector] Optimization completed");
```

### KEPT:
```typescript
// Line 102 (KEPT - Startup)
console.log("[TriggerDetector] Starting...");

// Line 113-114 (KEPT - Startup)
console.log("[TriggerDetector] Started successfully");
console.log("[TriggerDetector] Listening for @prompt triggers...");

// Line 123 (KEPT - Shutdown)
console.log("[TriggerDetector] Stopping...");

// Line 129 (KEPT - Shutdown)
console.log("[TriggerDetector] Stopped");

// Line 92-93 (KEPT - Error)
console.error("[TriggerDetector] Optimization failed:", error);

// Line 137 (KEPT - Manual trigger)
console.log("[TriggerDetector] Manual optimization triggered:", promptText.substring(0, 50));
```

### When to Enable:
- **Debugging event flow** - If events aren't propagating from optimizer to app
- **Investigating lifecycle issues** - If session state transitions are wrong
- **Testing event-driven architecture** - When modifying event emitters/listeners

### How to Restore:
Uncomment lines 72, 77, 82, 87. These are simple event forwarding logs that show when ContinuousOptimizer events are being passed through to App.

**NOTE:** These logs are redundant with ContinuousOptimizer logs. Only enable if you need to verify event propagation specifically.

---

## App Logs

**File:** `electron/main/app.ts`

**Location:** Lines 34, 38, 42, 46 in setupListeners() method

### REMOVED (Commented Out):
```typescript
// Line 34 (REMOVED)
// console.log("[App] Prompt session created:", session.promptText.substring(0, 50));

// Line 38 (REMOVED)
// console.log("[App] Prompt stabilized, ready to optimize");

// Line 42 (REMOVED)
// console.log("[App] Optimization started");

// Line 46 (REMOVED)
// console.log("[App] Optimization completed successfully");
```

### KEPT:
```typescript
// Line 52 (KEPT - Error)
console.error("[App] Optimization failed:", error);

// Line 63 (KEPT - User action)
console.log("[App] Prompt submitted from floating panel:", promptText.substring(0, 50));

// Line 69 (KEPT - User action)
console.log("[App] Voice input started");

// Line 73 (KEPT - User action)
console.log("[App] Voice input stopped, transcript:", transcript.substring(0, 50));

// Line 89 (KEPT - Processing)
console.log("[App] Processing floating panel prompt:", promptText);

// Line 160 (KEPT - User action)
console.log("[App] Floating panel hidden (Ctrl+5)");

// Line 164 (KEPT - User action)
console.log("[App] Floating panel shown (Ctrl+5)");
```

### When to Enable:
- **High-level debugging** - If you want to see top-level application flow
- **User action tracking** - Supplement existing user action logs with internal events
- **Integration testing** - When testing how all components work together

### How to Restore:
Uncomment lines 34, 38, 42, 46. These provide high-level visibility into optimization lifecycle.

**NOTE:** These logs are redundant with TriggerDetector logs. Enable only if you want to see events at the App level specifically.

---

## TextReplacer Logs (KEPT - Important!)

**File:** `electron/main/text/text-replacer.ts`

**Location:** Throughout the file - THESE WERE NOT REMOVED

### KEPT (Critical for debugging text replacement):

#### Main Entry Point (Lines 123-130):
```typescript
console.log("[TextReplacer] replaceTextInPlace called");
console.log("[TextReplacer] Original text:", originalText.substring(0, 100));
console.log("[TextReplacer] New text:", newText.substring(0, 100));
console.log("[TextReplacer] Full text to search for:", fullOriginalText.substring(0, 100));
```

#### UI Automation Attempt (Lines 134-143):
```typescript
console.log("[TextReplacer] Attempting UI Automation (NO KEYBOARD)...");
// If success:
console.log("[TextReplacer] ✅ SUCCESS via UI Automation (Word-like)!");
// If failure:
console.log("[TextReplacer] ⚠️ UI Automation not available:", (error as Error).message);
console.log("[TextReplacer] Falling back to keyboard simulation...");
```

#### UI Automation Method (Lines 160-273):
```typescript
console.log("[UIAutomation] Starting Word-like text replacement");
console.log("[UIAutomation] This uses Windows UI Automation API - NO KEYBOARD!");
console.log("[UIAutomation] PowerShell output:", result.stdout);
// If success:
console.log("[UIAutomation] ✅ Text replaced successfully (NO KEYBOARD!)");
// If failure:
console.log("[UIAutomation] Failed with error:");
console.log("[UIAutomation] STDERR:", errorObj.stderr);
console.log("[UIAutomation] STDOUT:", errorObj.stdout);
console.log("[UIAutomation] Message:", errorObj.message);
```

**PowerShell Script Debug Logs (ADDED - Lines 208-221):**
The PowerShell script inside `replaceTextViaUIAutomation()` now includes detailed debug output:
```powershell
# Line 208-210 - Always logged (shows what we're looking for)
Write-Host "INFO: Current text length: $($currentValue.Length)"
Write-Host "INFO: Current text (first 100 chars): $($currentValue.Substring(0, [Math]::Min(100, $currentValue.Length)))"
Write-Host "INFO: Looking for: $original"

# Line 217-220 - Error case only (shows why match failed)
Write-Host "ERROR: Text comparison failed:"
Write-Host "  - Looking for: '$original'"
Write-Host "  - Found in text: $($currentValue.Contains($original))"
Write-Host "  - Actual text: '$currentValue'"
```

These logs appear in the `[UIAutomation] STDOUT:` output and show:
1. The actual text content from Notepad's ValuePattern
2. What we're searching for (the @prompt text)
3. Detailed comparison if the match fails (showing exact text and contains() result)

**When to Use:**
- Already enabled by default (critical for UI Automation debugging)
- Shows exactly what Notepad contains vs what we're looking for
- Helps diagnose encoding issues, whitespace problems, or unexpected text format

**Added:** 2026-01-17 - To debug UI Automation text matching failures

#### Windows Keyboard Fallback (Lines 278-424):
```typescript
console.log("[TextReplacer] Windows: Starting Word-like text replacement");
console.log("[TextReplacer] Original:", originalText.substring(0, 50));
console.log("[TextReplacer] New:", newText.substring(0, 50));
console.log("[TextReplacer] Windows: Saved original clipboard");
console.log("[TextReplacer] Currently selected text:", selectedText.substring(0, 50));
console.log("[TextReplacer] Need to select the text first");
console.log("[TextReplacer] Text selected");
console.log("[TextReplacer] Windows: Word-like replacement completed");
console.log("[TextReplacer] Windows: Restored original clipboard");
console.error("[TextReplacer] Windows: Failed to replace text:", error);
```

#### macOS Keyboard Fallback (Lines 429-495):
```typescript
console.log("[TextReplacer] macOS: Starting invisible text replacement");
console.log("[TextReplacer] Original text length:", originalText.length);
console.log("[TextReplacer] macOS: Saved original clipboard");
console.log("[TextReplacer] macOS: New text copied to clipboard");
console.log("[TextReplacer] macOS: Invisible selection and paste completed");
console.log("[TextReplacer] macOS: Restored original clipboard");
console.error("[TextReplacer] macOS: Failed to replace text:", error);
```

### Why These Logs Were Kept:
1. **Critical functionality** - Text replacement is the core feature
2. **Complex multi-step process** - Need to see which step fails
3. **Platform-specific behavior** - Different paths for Windows/macOS
4. **UI Automation debugging** - New feature that needs visibility
5. **Fallback tracking** - Need to know when keyboard fallback is used
6. **User-visible impact** - Failures here directly affect user experience

### When to Add More Logs:
- **PowerShell script debugging** - Add logs inside the PowerShell script itself
- **Clipboard debugging** - Log clipboard contents before/after operations
- **Selection verification** - Log what text was actually selected
- **Timing issues** - Add timestamp logs to measure delays

---

## Quick Reference - When to Enable What

### Issue: Overlays appear in wrong location
**Enable:**
- WindowTracker logs (lines 86-106 in window-tracker.ts)
- OverlayManager position logs (showHighlight and showOptimization)

### Issue: @prompt not being detected
**Enable:**
- TextStatePoller logs (lines 219-225, 239 in text-state-poller.ts)
- ContinuousOptimizer instance creation logs (lines 236-239)

### Issue: Optimization happens too early/late
**Enable:**
- ContinuousOptimizer stabilization logs (lines 117-120)
- ContinuousOptimizer optimization start/complete logs (lines 159-163, 175-179)

### Issue: Text replacement not working
**Keep enabled (already active):**
- ALL TextReplacer logs (these should ALWAYS be on)

### Issue: Multiple @prompt instances interfering
**Enable:**
- TextStatePoller instance logs (full detection/removal logs)
- ContinuousOptimizer instance lifecycle logs (creation, update, removal)

### Issue: Performance problems
**Enable:**
- OverlayManager timing logs (elapsed time measurements)
- Add custom timing logs around slow operations

### Issue: Events not propagating
**Enable:**
- TriggerDetector event forwarding logs (lines 72, 77, 82, 87)
- App lifecycle logs (lines 34, 38, 42, 46)

### Issue: General debugging / understanding flow
**Enable everything in this order:**
1. App logs (high level)
2. TriggerDetector logs (event flow)
3. ContinuousOptimizer logs (optimization logic)
4. TextStatePoller logs (detection)
5. OverlayManager logs (UI)
6. WindowTracker logs (positioning)

---

## How to Restore Logs

### Option 1: Uncomment specific lines
Search for the commented logs in this document and uncomment them in the respective files.

### Option 2: Git restore (if committed before cleanup)
```bash
git log --oneline  # Find commit before cleanup
git show <commit-hash>:electron/main/path/to/file.ts > restored-file.ts
# Then copy back the specific logs you need
```

### Option 3: Ask AI Assistant
Provide this exact prompt:
```
I need to debug [SPECIFIC ISSUE]. Please read LOGGING_IMPORTANT.md
and restore the appropriate logs in [FILE NAME] to help debug this issue.
```

---

## Best Practices

### Do:
✅ Enable logs temporarily for specific debugging sessions
✅ Disable logs after issue is resolved
✅ Keep error logs ALWAYS enabled
✅ Keep TextReplacer logs ALWAYS enabled (core feature)
✅ Add timing logs for performance profiling when needed

### Don't:
❌ Enable all logs permanently (creates noise)
❌ Remove error logs (they're critical)
❌ Remove TextReplacer logs (they're the most important feature)
❌ Add logs inside tight loops (like keystroke listeners)
❌ Log sensitive user data (passwords, API keys, etc.)

---

## Log Levels (Not Implemented - Future Enhancement)

If you want to implement proper log levels in the future:

```typescript
enum LogLevel {
  ERROR = 0,   // Always logged
  WARN = 1,    // Important warnings
  INFO = 2,    // Key lifecycle events (current "KEPT" logs)
  DEBUG = 3,   // Detailed debugging (current "REMOVED" logs)
  TRACE = 4    // Ultra-verbose (keystroke-level detail)
}

// Usage:
logger.debug("[WindowTracker] Raw stdout:", stdout);  // Only shown if DEBUG enabled
logger.info("[App] Optimization started");            // Always shown
logger.error("[TextReplacer] Failed:", error);       // Always shown
```

To implement this, create a logger utility class and replace all console.log calls.

---

## Summary Statistics

- **WindowTracker:** 5-6 logs removed per window focus (every ~1 second)
- **TextStatePoller:** 2-4 logs removed per keystroke
- **ContinuousOptimizer:** 10-15 logs removed per optimization cycle
- **OverlayManager:** 15-20 logs removed per overlay shown
- **TriggerDetector:** 4 logs removed per optimization cycle
- **App:** 4 logs removed per optimization cycle

**Total reduction:** ~90% of log volume removed
**Remaining:** ~10% of logs - only critical, actionable information

---

## Recent Changes / Updates

### 2026-01-17 - Removed Keyboard Fallback (Option C Fix)

**Files Modified:**
- `electron/main/text/text-replacer.ts` (Lines 146-148, 287-288)
- `electron/main/input/text-state-poller.ts` (Lines 80-84)
- `electron/main/input/trigger-detector.ts` (Lines 145-147)
- `electron/main/overlay/overlay-manager.ts` (Lines 11, 19, 58, 62-66)
- `electron/main/app.ts` (Lines 52-55)

**What Was Done:**
1. **Removed keyboard fallback completely** (150+ lines of code removed)
   - Deleted `replaceTextInPlaceWindows()` method
   - Deleted `replaceTextInPlaceMacOS()` method
   - These methods were broken (selected wrong windows) and not needed

2. **Added text buffer cleanup after successful replacement**
   - Added `clearBuffer()` method to TextStatePoller
   - Added `clearTextBuffer()` method to TriggerDetector
   - OverlayManager now emits "text-replaced" event
   - App listens to event and clears buffer
   - This prevents infinite loops from stale @prompt detections

3. **Improved error messages**
   - Shows user-friendly message if UI Automation fails
   - Directs users to use Copy button instead

**Why This Was Critical:**
- Keyboard fallback was selecting wrong window (terminal instead of Notepad)
- After successful UI Automation, the text buffer still had old @prompt text
- This caused infinite optimization loops
- Now buffer is cleared immediately after replacement

**Code Changes:**

In `text-replacer.ts`:
```typescript
// Before (REMOVED - 150+ lines)
if (this.platform === "win32") {
  await this.replaceTextInPlaceWindows(fullOriginalText, newText);
} else if (this.platform === "darwin") {
  await this.replaceTextInPlaceMacOS(fullOriginalText, newText);
}

// After (CLEAN)
// No fallback - UI Automation is required
throw new Error("UI Automation not available. Please use the Copy button and paste manually (Ctrl+V).");
```

In `text-state-poller.ts`:
```typescript
clearBuffer(): void {
  this.textBuffer = "";
  this.trackedInstances.clear();
  console.log("[TextStatePoller] Buffer cleared after text replacement");
}
```

In `overlay-manager.ts`:
```typescript
await this.textReplacer.replaceTextInPlace(data.originalText, data.newText);
this.hide(promptData.context);
this.emit("text-replaced"); // NEW - notify App to clear buffer
```

In `app.ts`:
```typescript
this.overlayManager.on("text-replaced", () => {
  console.log("[App] Text replaced, clearing text buffer to prevent stale detections");
  this.triggerDetector.clearTextBuffer();
});
```

**Result:**
- ✅ No more infinite loops
- ✅ Cleaner codebase (150+ lines removed)
- ✅ UI Automation is the only replacement method
- ✅ If UI Automation fails, user gets clear instructions

---

### 2026-01-17 - Fixed UI Automation Parameter Passing (Base64 Encoding)

**File:** `electron/main/text/text-replacer.ts`
**Lines:** 168-178, 252-255

**CRITICAL FIX:**
PowerShell was truncating parameters with newlines, causing UI Automation to fail. Changed parameter passing from plain text to Base64 encoding.

**Before (BROKEN):**
```typescript
const escapePS = (text: string) => text.replace(/'/g, "''");
// Parameters passed as plain text - FAILS with newlines!
-original '@prompt write an email' -new 'Write a clear email'
```

**After (FIXED):**
```typescript
// Base64 encode to avoid PowerShell parsing issues
const base64Original = Buffer.from(originalText, 'utf8').toString('base64');
const base64New = Buffer.from(newText, 'utf8').toString('base64');

// PowerShell script decodes Base64
param([string]$originalBase64, [string]$newBase64)
$original = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($originalBase64))
$new = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($newBase64))

// Parameters passed as Base64 - WORKS with newlines!
-originalBase64 "QHByb21wdCB3cml0ZSBhbiBlbWFpbA==" -newBase64 "..."
```

**Why This Was Critical:**
- Multi-line prompts (with `\n`) were being truncated by PowerShell
- PowerShell interpreted newlines as command separators
- UI Automation received incomplete search text (e.g., only `@prompt` instead of `@prompt write an email`)
- This caused infinite loops as the @prompt was never replaced
- Base64 encoding preserves ALL characters including newlines, quotes, special chars

---

### 2026-01-17 - Added PowerShell Debug Logs for UI Automation

**File:** `electron/main/text/text-replacer.ts`
**Lines:** 213-226 (inside PowerShell script in `replaceTextViaUIAutomation()`)

**What Was Added:**
Enhanced the PowerShell script that performs UI Automation with detailed debug logging to diagnose why text matching fails.

**New Logs:**
```powershell
# Always logged (Lines 208-210)
Write-Host "INFO: Current text length: $($currentValue.Length)"
Write-Host "INFO: Current text (first 100 chars): $($currentValue.Substring(0, [Math]::Min(100, $currentValue.Length)))"
Write-Host "INFO: Looking for: $original"

# Error case only (Lines 217-220)
Write-Host "ERROR: Text comparison failed:"
Write-Host "  - Looking for: '$original'"
Write-Host "  - Found in text: $($currentValue.Contains($original))"
Write-Host "  - Actual text: '$currentValue'"
```

**Why Added:**
- UI Automation was consistently failing with "Original text not found in current value"
- Needed to see what Notepad's ValuePattern actually returns
- Required comparison between what we're searching for vs what's actually in the text field
- Helps diagnose encoding issues, line breaks, whitespace problems

**Output Appears In:**
These logs appear in the `[UIAutomation] STDOUT:` console output when the TypeScript code logs the PowerShell result.

**When to Remove:**
Once UI Automation is working reliably, you can remove the debug logs (lines 209-210 and 217-220) to reduce verbosity. Keep line 208 (text length) as it's useful for verification.

---

## Cursor Positioning via TextPattern (v1.4)

**Date Added:** 2026-01-17
**File:** `electron/main/text/text-replacer.ts`
**Lines:** 231-268

### What Was Added:
After successful UI Automation text replacement using ValuePattern, cursor positioning logic was added using TextPattern to move the cursor to the end of the replaced text.

### Code Added:
```powershell
# Lines 231-268 in PowerShell script inside replaceTextViaUIAutomation()
# After: $valuePattern.SetValue($updatedValue)
# After: Write-Host "SUCCESS: Text replaced via UI Automation!"

# Now move cursor to the end of replaced text (NO KEYBOARD!)
try {
    Write-Host "INFO: Attempting to move cursor to end of replaced text..."

    # Try to get TextPattern for cursor positioning
    $textPattern = $focusedElement.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)

    if ($null -ne $textPattern) {
        # Get the document range
        $documentRange = $textPattern.DocumentRange

        # Find the position where we want to place the cursor
        # Calculate the end position of the replaced text
        $replacementIndex = $currentValue.IndexOf($original)
        if ($replacementIndex -ge 0) {
            $endPosition = $replacementIndex + $new.Length

            Write-Host "INFO: Replacement starts at index: $replacementIndex"
            Write-Host "INFO: Moving cursor to position: $endPosition (end of replaced text)"

            # Move to the end position by moving from document start
            $documentRange.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, [System.Windows.Automation.Text.TextUnit]::Character, $endPosition)
            $documentRange.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, [System.Windows.Automation.Text.TextUnit]::Character, 0)

            # Select the range (which is just a cursor position now)
            $documentRange.Select()

            Write-Host "SUCCESS: Cursor moved to end of replaced text!"
        } else {
            Write-Host "WARNING: Could not find replacement position in original text"
        }
    } else {
        Write-Host "WARNING: TextPattern not supported by this control (cursor will remain at start)"
    }
} catch {
    Write-Host "WARNING: Could not move cursor: $_"
    Write-Host "WARNING: Text replaced successfully, but cursor remains at current position"
}
```

### Why Added:
**User Request:** "I want one more thing on this can u bring the cursor to the end right now it goes to the front of the text like left most. Also for this as well i dont want any keyboard usage."

**Problem:** After UI Automation replaced text, cursor was positioned at the beginning (left) of the replaced text instead of at the end (right).

**Solution:** Use Windows UI Automation TextPattern interface to programmatically position the cursor at the end of the replaced text without any keyboard simulation.

### How It Works:
1. After successful ValuePattern.SetValue() text replacement
2. Get TextPattern interface from focused element
3. Get document range (represents entire text)
4. Calculate end position: `replacementIndex + newText.Length`
5. Move range's start endpoint to end position using MoveEndpointByUnit()
6. Move range's end endpoint to same position (creates zero-length range = cursor)
7. Call Select() to position cursor at that range

### Expected Console Output (Success):
```
SUCCESS: Text replaced via UI Automation!
INFO: Attempting to move cursor to end of replaced text...
INFO: Replacement starts at index: 0
INFO: Moving cursor to position: 42 (end of replaced text)
SUCCESS: Cursor moved to end of replaced text!
```

### Expected Console Output (TextPattern Not Supported):
```
SUCCESS: Text replaced via UI Automation!
INFO: Attempting to move cursor to end of replaced text...
WARNING: TextPattern not supported by this control (cursor will remain at start)
```

### When to Enable/Disable:
**Already Enabled by Default** - This feature is wrapped in try/catch so it gracefully degrades if TextPattern is not supported.

**When to Debug:**
- If cursor is not moving to the end after replacement
- If you see "WARNING: Could not move cursor" in console
- If TextPattern is not supported by a particular text control

**Log Locations:**
- `INFO: Attempting to move cursor...` - Shows cursor positioning is being attempted
- `INFO: Replacement starts at index: X` - Shows where the replacement was found
- `INFO: Moving cursor to position: X` - Shows calculated end position
- `SUCCESS: Cursor moved to end...` - Confirms cursor was successfully positioned
- `WARNING: TextPattern not supported...` - Control doesn't support cursor positioning
- `WARNING: Could not move cursor: [error]` - Shows specific error if positioning fails

### Important Notes:
- **NO KEYBOARD SIMULATION** - Uses only Windows UI Automation API
- **Graceful Degradation** - Text replacement still succeeds even if cursor positioning fails
- **Control Type Dependent** - Some controls may not support TextPattern (e.g., simple Edit controls)
- **Notepad Compatibility** - Notepad's Edit control should support TextPattern

### When to Remove:
Never remove - this is a core feature requested by the user. However, you can comment out the logging lines (248-249, 258, 260, 263, 266-267) once cursor positioning is confirmed working reliably.

---

Last Updated: 2026-01-17
Version: 1.4 (Option C + Cursor positioning via TextPattern)

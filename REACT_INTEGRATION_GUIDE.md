# React Component Integration Guide

## Overview

This guide explains how to integrate your React `QuickOptimize` component with the Electron backend to support the new `@prompt` workflow.

## Key Changes Made

### 1. **TypeScript Type Definitions**

Add these types to your project (e.g., `types/electron.d.ts`):

```typescript
interface Window {
  electronAPI: {
    // Existing methods
    send: (channel: string, data: any) => void;

    // NEW: Event listeners for main → renderer
    onExpandToInput: (callback: () => void) => void;
    onFocusInput: (callback: () => void) => void;
  };
}
```

### 2. **State Management**

Added new state for panel expansion:

```typescript
const [isPanelExpanded, setIsPanelExpanded] = useState(false);
const inputRef = useRef<HTMLTextAreaElement>(null);
```

### 3. **Electron IPC Integration**

#### A. Listen to Events from Main Process

```typescript
useEffect(() => {
  if (typeof window !== 'undefined' && window.electronAPI) {

    // Expand panel when @prompt detected
    window.electronAPI.onExpandToInput(() => {
      setIsPanelExpanded(true);
      setInputPrompt("");
      setOptimizedPrompt("");
    });

    // Focus input field
    window.electronAPI.onFocusInput(() => {
      inputRef.current?.focus();
    });

    // ESC key handler
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissPanel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }
}, []);
```

#### B. Send Events to Main Process

```typescript
// Dismiss panel
const dismissPanel = () => {
  window.electronAPI.send('floating-panel:dismiss', {});
  // Reset state
};

// Replace @prompt with optimized text
const replaceOriginal = () => {
  window.electronAPI.send('floating-panel:replace-text', {
    optimizedText: optimizedPrompt
  });
};

// Submit prompt for optimization
const optimizePrompt = () => {
  window.electronAPI.send('floating-panel:prompt-submit', inputPrompt);
};
```

## Complete Workflow

### Step 1: User Types `@prompt` in ChatGPT

```
1. User types: @prompt
   ↓
2. Main process detects it
   ↓
3. Main sends 'expand-to-input' → React component
   ↓
4. React: setIsPanelExpanded(true)
   ↓
5. Main sends 'focus-input' → React component
   ↓
6. React: inputRef.current.focus()
```

### Step 2: User Types Prompt

```
1. User types: "Write a blog post on AI"
   ↓
2. User presses Enter or clicks "Generate"
   ↓
3. React sends 'floating-panel:prompt-submit' → Main
   ↓
4. Main calls Python service to optimize
   ↓
5. Optimization completes
   ↓
6. [TODO] Main sends result back to React
   ↓
7. React: setOptimizedPrompt(result)
```

### Step 3: User Clicks "Replace Original"

```
1. User clicks "Replace Original" button
   ↓
2. React sends 'floating-panel:replace-text' → Main
   with { optimizedText: "..." }
   ↓
3. Main process:
   - Hides floating panel
   - Restores focus to ChatGPT window
   - Sends 7 Backspace keys
   - Sends Ctrl+V (paste)
   ↓
4. Optimized text replaces @prompt in ChatGPT ✓
```

## Missing Piece: Receiving Optimization Results

Currently, the optimization result needs to be sent back to the renderer. You have two options:

### Option A: Use IPC Event (Recommended)

**1. Add to preload.ts:**

```typescript
onOptimizationComplete: (callback: (data: { optimized: string }) => void) => {
  ipcRenderer.on("optimization-complete", (event, data) => callback(data));
}
```

**2. In main process (app.ts):**

```typescript
this.triggerDetector.on("optimization-completed", (session) => {
  const panelWindow = this.floatingPanel.getWindow();
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send("optimization-complete", {
      optimized: session.optimizedText
    });
  }
});
```

**3. In React component:**

```typescript
useEffect(() => {
  if (window.electronAPI?.onOptimizationComplete) {
    window.electronAPI.onOptimizationComplete((data) => {
      setOptimizedPrompt(data.optimized);
      setStatus("ready");
      setIsOptimizing(false);
      toast.success("Prompt optimized!");
    });
  }
}, []);
```

### Option B: Use Direct API Call

If you prefer, you can call the Python service directly from the renderer:

```typescript
const optimizePrompt = async () => {
  const response = await fetch('http://127.0.0.1:8001/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: inputPrompt })
  });
  const result = await response.json();
  setOptimizedPrompt(result.optimized);
};
```

## Testing Checklist

Once integrated:

- [ ] Type `@prompt` anywhere → Panel auto-shows in expanded state
- [ ] Input field is auto-focused (can type immediately)
- [ ] Type prompt text → Click "Generate" → See optimized result
- [ ] Click "Replace Original" → Should see @prompt replaced in original window
- [ ] Press ESC → Panel dismisses
- [ ] Click X button → Panel dismisses
- [ ] Type `@prompt` again → Should work again

## UI States

The component handles 3 states:

1. **idle** - Waiting for user input
2. **optimizing** - Processing prompt (shows spinner)
3. **ready** - Optimization complete (shows result + green indicator)

## Keyboard Shortcuts

- **Ctrl+Enter / Cmd+Enter** - Submit prompt for optimization
- **ESC** - Dismiss panel

## Error Handling

The component includes error handling for:
- Empty input
- Optimization failures
- Electron API not available (fallback for web)

## Styling Notes

The component uses:
- Tailwind CSS classes
- Custom glass-panel effects
- Lucide React icons
- Sonner for toast notifications

Make sure these dependencies are installed:
```bash
npm install lucide-react sonner
```

## Production Considerations

1. **Remove Mock Data**: The current implementation uses a mock 2-second delay. Replace with actual optimization result from main process.

2. **Add Loading States**: Consider adding skeleton loaders or progress indicators during optimization.

3. **Add Error States**: Show user-friendly error messages if optimization fails.

4. **Add Retry Logic**: Allow users to retry failed optimizations.

5. **Add Analytics**: Track optimization success rate, average time, etc.

## Next Steps

1. Update your existing React component with the changes from `QuickOptimize_INTEGRATED.tsx`
2. Add the optimization result listener (Option A or B above)
3. Test the complete workflow
4. Build and run: `npm run dev`

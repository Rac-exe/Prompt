# Renderer Updates Needed for New @prompt Workflow

## Overview
The backend has been updated to support the new workflow. The floating panel renderer (`floating-panel-v2.html`) needs to be updated to handle new events and send the correct IPC messages.

## Changes Made to Backend

### 1. Detection Only Captures `@prompt` (7 characters)
- No longer captures text after `@prompt`
- Floating panel auto-shows when `@prompt` is typed

### 2. New IPC Events from Main → Renderer

#### `expand-to-input` Event
**When:** Main sends this when `@prompt` is detected
**Purpose:** Tell the renderer to switch from collapsed (logo) state to expanded (input) state
**Renderer Action:** Switch to expanded state showing the text input field

```javascript
// In floating-panel-v2.html
window.electronAPI.onExpandToInput(() => {
  // Switch from collapsed state to expanded state
  // Example: if using state management
  setState('expanded'); // or whatever your state management does
});
```

#### `focus-input` Event
**When:** Main sends this after `expand-to-input` (150ms delay)
**Purpose:** Focus the text input field so user can immediately start typing
**Renderer Action:** Focus the input element

```javascript
// In floating-panel-v2.html
window.electronAPI.onFocusInput(() => {
  const inputElement = document.querySelector('#prompt-input'); // or whatever your input ID is
  if (inputElement) {
    inputElement.focus();
  }
});
```

### 3. New IPC Events from Renderer → Main

#### `floating-panel:replace-text` Event
**When:** User clicks the "Replace" button after optimization completes
**Purpose:** Send the optimized text back to main for replacement
**Renderer Action:** Send optimized text via IPC

```javascript
// When Replace button is clicked
replaceButton.addEventListener('click', () => {
  const optimizedText = /* get optimized text from your state */;

  window.electronAPI.send('floating-panel:replace-text', {
    optimizedText: optimizedText
  });
});
```

#### `floating-panel:dismiss` Event
**When:** User presses ESC key or clicks outside the panel
**Purpose:** Dismiss the floating panel and clear stored context
**Renderer Action:** Send dismiss event

```javascript
// ESC key handler
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.electronAPI.send('floating-panel:dismiss');
  }
});

// Click outside handler (if applicable)
// You might implement this using blur event or click-outside detection
```

## Complete Example Flow

### Step 1: User Types `@prompt` in ChatGPT
```
User types: @prompt
└─> Main detects @prompt (7 chars)
    └─> Main stores: cursorPosition = 7, windowHandle, etc.
        └─> Main shows floating panel
            └─> Main sends 'expand-to-input' to renderer
                └─> Renderer switches to expanded state
                    └─> Main sends 'focus-input' to renderer (150ms later)
                        └─> Renderer focuses input field
```

### Step 2: User Types Prompt in Floating Panel
```
User types: "Write a blog post on AI"
└─> User clicks Submit/Enter
    └─> Renderer sends 'floating-panel:prompt-submit' (already exists)
        └─> Main optimizes prompt via Python service
            └─> Optimization completes
                └─> Renderer shows optimized text (your existing UI)
```

### Step 3: User Clicks Replace Button
```
User clicks "Replace" button
└─> Renderer sends 'floating-panel:replace-text' with optimizedText
    └─> Main hides floating panel
        └─> Main restores focus to original window (ChatGPT)
            └─> Main sends 7 Backspace keys (delete @prompt)
                └─> Main sends Ctrl+V (paste optimized text)
                    └─> Done! Optimized text replaces @prompt in ChatGPT
```

### Step 4: User Dismisses Panel (Optional)
```
User presses ESC or clicks outside
└─> Renderer sends 'floating-panel:dismiss'
    └─> Main hides panel
        └─> Main clears stored context
            └─> Done!
```

## Required Renderer Changes Summary

### 1. Add Event Listeners (in floating-panel-v2.html)
```javascript
// Listen for expand command
window.electronAPI.onExpandToInput(() => {
  // TODO: Switch to expanded state
});

// Listen for focus command
window.electronAPI.onFocusInput(() => {
  // TODO: Focus the input field
});
```

### 2. Update Replace Button Handler
```javascript
replaceButton.addEventListener('click', () => {
  const optimizedText = /* your optimized text */;

  // Send replace request to main
  window.electronAPI.send('floating-panel:replace-text', {
    optimizedText: optimizedText
  });
});
```

### 3. Add Dismissal Handlers
```javascript
// ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.electronAPI.send('floating-panel:dismiss');
  }
});

// Optional: Click outside (if using blur detection)
window.addEventListener('blur', () => {
  window.electronAPI.send('floating-panel:dismiss');
});
```

## Testing Checklist

Once renderer is updated, test in Notepad or ChatGPT:

- [ ] Type `@prompt` anywhere → Floating panel appears in **expanded state with input visible**
- [ ] Input field is **automatically focused** (can type immediately)
- [ ] Type prompt text → Click submit → Optimization happens
- [ ] Click **Replace button** → Should delete `@prompt` and paste optimized text
- [ ] Original window (ChatGPT/Notepad) regains focus automatically
- [ ] Press **ESC** → Panel dismisses
- [ ] Type `@prompt` again → Should work again (no stale context)

## Notes

- The preload.ts has already been updated with the new event listeners
- The backend (main process) is fully implemented and ready
- Only the renderer (floating-panel-v2.html) needs updates
- The Replace button is the key new feature - it triggers the text replacement

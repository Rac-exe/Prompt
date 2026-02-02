# ⚠️ CRITICAL: Electron API Integration Required

## Status: Hardcoded Mock Data - Needs Backend Connection

### Problem
The Lovable-built React UI currently uses **hardcoded mock responses** for prompt optimization. It is NOT connected to your Python backend or Electron IPC system.

---

## 🔧 What Needs to Be Done

### 1. Create Electron API Bridge
**Location:** `app-ui/src/lib/electron-api.ts` (CREATE THIS FILE)

```typescript
// Detect if running in Electron
export const isElectron = () => {
  return !!(window as any).electronAPI;
};

// Type-safe Electron API
export const electronAPI = {
  // Optimize prompt via Python service
  optimizePrompt: (text: string) => {
    if (isElectron()) {
      (window as any).electronAPI.send('app:optimize-prompt', { text });
    }
  },

  // Listen for optimization results
  onOptimizationComplete: (callback: (data: { optimized: string, original: string }) => void) => {
    if (isElectron()) {
      (window as any).electronAPI.on('optimization-complete', callback);
    }
  },

  // Clean up listeners
  removeOptimizationListener: () => {
    if (isElectron()) {
      (window as any).electronAPI.off('optimization-complete');
    }
  }
};
```

### 2. Update Index.tsx to Use Electron API

**Current Code (Lines ~193-230):**
```typescript
const handleSendMessage = useCallback((content: string) => {
  // ... user message code ...

  // ❌ CURRENTLY USING MOCK DATA:
  setTimeout(() => {
    const responseIndex = Math.floor(Math.random() * optimizedResponses.length);
    const assistantMessage: Message = {
      id: `msg-${Date.now() + 1}`,
      role: "assistant",
      content: optimizedResponses[responseIndex],  // ← HARDCODED!
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsGenerating(false);
  }, 1500);
}, [selectedChatId]);
```

**Replace With:**
```typescript
import { electronAPI, isElectron } from "@/lib/electron-api";

// Add this useEffect in Index component
useEffect(() => {
  if (!isElectron()) return;

  // Set up listener for optimization results
  electronAPI.onOptimizationComplete((data) => {
    const assistantMessage: Message = {
      id: `msg-${Date.now()}`,
      role: "assistant",
      content: data.optimized,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setIsGenerating(false);
  });

  // Cleanup on unmount
  return () => {
    electronAPI.removeOptimizationListener();
  };
}, []);

const handleSendMessage = useCallback((content: string) => {
  const userMessage: Message = {
    id: `msg-${Date.now()}`,
    role: "user",
    content,
    timestamp: new Date(),
  };

  setMessages((prev) => [...prev, userMessage]);
  setIsGenerating(true);

  if (isElectron()) {
    // ✅ Use real Electron API
    electronAPI.optimizePrompt(content);
  } else {
    // Fallback for web development
    setTimeout(() => {
      const mockMessage: Message = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: "Mock response (web mode - Electron API not available)",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, mockMessage]);
      setIsGenerating(false);
    }, 1000);
  }

  // Auto-create chat if needed
  if (!selectedChatId) {
    const newChatId = `chat-${Date.now()}`;
    const preview = content.slice(0, 50);
    const newChat = {
      id: newChatId,
      title: preview.length < content.length ? `${preview}...` : preview,
      date: new Date().toISOString(),
    };
    setRecentChats((prev) => [newChat, ...prev]);
    setSelectedChatId(newChatId);
  }
}, [selectedChatId]);
```

### 3. Verify Electron Preload Script

**Check:** `electron/preload.ts` should expose these IPC methods:

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel: string, data?: any) => {
    const validChannels = ['app:optimize-prompt', /* other channels */];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel: string, func: Function) => {
    const validChannels = ['optimization-complete', /* other channels */];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => func(...args));
    }
  },
  off: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
```

### 4. Verify Main Process Handler

**Check:** `electron/main/index-new.ts` should handle the IPC:

```typescript
ipcMain.on('app:optimize-prompt', async (event, { text }) => {
  try {
    // Call Python service
    const result = await pythonClient.optimize(text);

    // Send back to renderer
    event.sender.send('optimization-complete', {
      optimized: result.optimized,
      original: text
    });
  } catch (error) {
    console.error('Optimization error:', error);
    event.sender.send('optimization-complete', {
      optimized: text,  // Fallback to original
      original: text
    });
  }
});
```

---

## 🐛 Bug Fix: Optimization Duplication (Issue #11)

The user reports getting the same result 4 times. This is likely because:

1. **Multiple event listeners** - The useEffect might be adding listeners multiple times
2. **Missing dependency array** - React re-running the effect
3. **State update loops** - Setting state triggering re-renders

**Solution:**
- Ensure `electronAPI.onOptimizationComplete` is only called ONCE
- Add proper cleanup in useEffect return
- Use `useCallback` for message handler with correct dependencies

---

## 📋 Implementation Checklist

- [ ] Create `app-ui/src/lib/electron-api.ts`
- [ ] Update `app-ui/src/pages/Index.tsx` imports
- [ ] Replace `handleSendMessage` with Electron API version
- [ ] Add `useEffect` for optimization listener
- [ ] Remove or comment out `optimizedResponses` mock data
- [ ] Verify `electron/preload.ts` exposes correct APIs
- [ ] Verify `electron/main/index-new.ts` handles IPC
- [ ] Test in Electron app (not web browser)
- [ ] Fix duplication issue (ensure single listener)
- [ ] Rebuild: `npm run build:ui`

---

## 🧪 Testing

1. **Start Python service:** `npm run python:dev`
2. **Build UI:** `npm run build`
3. **Run Electron:** `npm run dev`
4. **Test optimization:**
   - Type a prompt
   - Click Generate
   - Should call Python service via Electron IPC
   - Should display real AI-optimized result
   - Should NOT show hardcoded mock responses
   - Should NOT duplicate (appears only once)

---

## 📁 Files to Modify

1. **CREATE:** `app-ui/src/lib/electron-api.ts`
2. **MODIFY:** `app-ui/src/pages/Index.tsx` (lines ~193-230)
3. **VERIFY:** `electron/preload.ts`
4. **VERIFY:** `electron/main/index-new.ts`

---

## ⏱️ Estimated Time: 15-20 minutes

This is the FINAL critical piece to connect your beautiful new UI to your existing Python optimization backend!

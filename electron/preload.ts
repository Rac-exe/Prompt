import { contextBridge, ipcRenderer } from "electron";

// Declare window type for TypeScript
declare global {
  interface Window {
    __contextKey?: string;
    electronAPI: {
      replaceText: (text: string) => void;
      replaceTextInPlace: (originalText: string, newText: string) => void;
      copyToClipboard: (text: string) => void;
      reOptimize: (originalText: string) => void;
      dismiss: () => void;
      onStateUpdate: (callback: (state: any) => void) => void;
      startTranscription: () => void;
      stopTranscription: () => void;
      onTranscriptionUpdate: (callback: (data: any) => void) => void;
      setPromptText: (text: string) => void;
      resizeWindow: (width: number, height: number) => void;
      send: (channel: string, data: any) => void;
      onExpandToInput: (callback: () => void) => void;
      onFocusInput: (callback: () => void) => void;
      onOptimizationComplete: (callback: (data: { optimized: string; original: string }) => void) => void;
      onToggleState: (callback: () => void) => void;
    };
  }
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const electronAPI = {
  replaceText: (text: string) => {
    // Get context key from window
    const contextKey = (globalThis as any).__contextKey;
    if (contextKey) {
      ipcRenderer.send("replace-text", { contextKey, text });
    }
  },
  replaceTextInPlace: (originalText: string, newText: string) => {
    // Get context key from window
    const contextKey = (globalThis as any).__contextKey;
    if (contextKey) {
      ipcRenderer.send("replace-text-in-place", { contextKey, originalText, newText });
    }
  },
  copyToClipboard: (text: string) => {
    ipcRenderer.send("copy-to-clipboard", text);
  },
  reOptimize: (originalText: string) => {
    const contextKey = (globalThis as any).__contextKey;
    if (contextKey) {
      ipcRenderer.send("re-optimize", { contextKey, originalText });
    }
  },
  dismiss: () => {
    const contextKey = (globalThis as any).__contextKey;
    if (contextKey) {
      ipcRenderer.send("dismiss-overlay", contextKey);
    }
  },
  onStateUpdate: (callback: (state: any) => void) => {
    ipcRenderer.on("update-state", (event, state) => callback(state));
  },
  startTranscription: () => {
    ipcRenderer.send("floating-panel:transcription-start");
  },
  stopTranscription: () => {
    ipcRenderer.send("floating-panel:transcription-stop");
  },
  onTranscriptionUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on("transcription-update", (event, data) => callback(data));
  },
  setPromptText: (text: string) => {
    ipcRenderer.send("floating-panel:set-prompt-text", text);
  },
  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send("floating-panel:resize", { width, height });
  },
  send: (channel: string, data: any) => {
    ipcRenderer.send(channel, data);
  },
  onExpandToInput: (callback: () => void) => {
    ipcRenderer.on("expand-to-input", () => callback());
  },
  onFocusInput: (callback: () => void) => {
    ipcRenderer.on("focus-input", () => callback());
  },
  onOptimizationComplete: (callback: (data: { optimized: string; original: string }) => void) => {
    ipcRenderer.on("optimization-complete", (event, data) => callback(data));
  },
  onToggleState: (callback: () => void) => {
    ipcRenderer.on("toggle-state", () => callback());
  }
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Listen for context key from main process
ipcRenderer.on("set-context-key", (event, contextKey: string) => {
  (globalThis as any).__contextKey = contextKey;
});

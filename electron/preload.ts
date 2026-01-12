import { contextBridge, ipcRenderer } from "electron";

// Declare window type for TypeScript
declare global {
  interface Window {
    __contextKey?: string;
    electronAPI: {
      replaceText: (text: string) => void;
      dismiss: () => void;
      onStateUpdate: (callback: (state: any) => void) => void;
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
  dismiss: () => {
    const contextKey = (globalThis as any).__contextKey;
    if (contextKey) {
      ipcRenderer.send("dismiss-overlay", contextKey);
    }
  },
  onStateUpdate: (callback: (state: any) => void) => {
    ipcRenderer.on("update-state", (event, state) => callback(state));
  }
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Listen for context key from main process
ipcRenderer.on("set-context-key", (event, contextKey: string) => {
  (globalThis as any).__contextKey = contextKey;
});

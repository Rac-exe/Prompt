import { contextBridge, ipcRenderer } from "electron";

// Declare window type for TypeScript
declare global {
  interface Window {
    __contextKey?: string;
    electronAPI: {
      replaceText: (text: string) => void;
      dismiss: () => void;
      onStateUpdate: (callback: (state: any) => void) => void;
      startTranscription: () => void;
      stopTranscription: () => void;
      onTranscriptionUpdate: (callback: (data: any) => void) => void;
      setPromptText: (text: string) => void;
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
  }
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Listen for context key from main process
ipcRenderer.on("set-context-key", (event, contextKey: string) => {
  (globalThis as any).__contextKey = contextKey;
});

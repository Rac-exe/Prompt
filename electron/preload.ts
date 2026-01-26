import { contextBridge, ipcRenderer } from 'electron';

// Declare window type for TypeScript
declare global {
  interface Window {
    __contextKey?: string;
    electronAPI: {
      // Overlay-specific API
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
      onExpandToInput: (callback: () => void) => void;
      onFocusInput: (callback: () => void) => void;
      onOptimizationComplete: (callback: (data: { optimized: string; original: string }) => void) => void;
      onToggleState: (callback: () => void) => void;

      // App window-specific API
      optimizePrompt: (text: string, isRegenerate?: boolean) => void;
      saveToChat: (originalText: string, optimizedText: string) => void;
      requestUserData: () => void;
      onUserDataLoaded: (callback: (user: any) => void) => void;
      onChatSaved: (callback: (data: { chatId: string }) => void) => void;
      signOut: () => void;

      // Common API
      send: (channel: string, data: any) => void;
    };
  }
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const electronAPI = {
  // ============================================
  // OVERLAY-SPECIFIC API
  // ============================================
  replaceText: (text: string) => {
    const contextKey = (globalThis as any).__contextKey;
    if (contextKey) {
      ipcRenderer.send('replace-text', { contextKey, text });
    }
  },
  replaceTextInPlace: (originalText: string, newText: string) => {
    const contextKey = (globalThis as any).__contextKey;
    if (contextKey) {
      ipcRenderer.send('replace-text-in-place', { contextKey, originalText, newText });
    }
  },
  copyToClipboard: (text: string) => {
    ipcRenderer.send('copy-to-clipboard', text);
  },
  reOptimize: (originalText: string) => {
    const contextKey = (globalThis as any).__contextKey;
    if (contextKey) {
      ipcRenderer.send('re-optimize', { contextKey, originalText });
    }
  },
  dismiss: () => {
    const contextKey = (globalThis as any).__contextKey;
    if (contextKey) {
      ipcRenderer.send('dismiss-overlay', contextKey);
    }
  },
  onStateUpdate: (callback: (state: any) => void) => {
    ipcRenderer.on('update-state', (event, state) => callback(state));
  },
  startTranscription: () => {
    ipcRenderer.send('floating-panel:transcription-start');
  },
  stopTranscription: () => {
    ipcRenderer.send('floating-panel:transcription-stop');
  },
  onTranscriptionUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('transcription-update', (event, data) => callback(data));
  },
  setPromptText: (text: string) => {
    ipcRenderer.send('floating-panel:set-prompt-text', text);
  },
  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send('floating-panel:resize', { width, height });
  },
  onExpandToInput: (callback: () => void) => {
    ipcRenderer.on('expand-to-input', () => callback());
  },
  onFocusInput: (callback: () => void) => {
    ipcRenderer.on('focus-input', () => callback());
  },
  onOptimizationComplete: (callback: (data: { optimized: string; original: string }) => void) => {
    ipcRenderer.on('optimization-complete', (event, data) => callback(data));
  },
  onToggleState: (callback: () => void) => {
    ipcRenderer.on('toggle-state', () => callback());
  },

  // ============================================
  // APP WINDOW-SPECIFIC API
  // ============================================
  optimizePrompt: (text: string, isRegenerate: boolean = false) => {
    ipcRenderer.send('app:optimize-prompt', text, isRegenerate);
  },
  saveToChat: (originalText: string, optimizedText: string) => {
    ipcRenderer.send('app:save-to-chat', originalText, optimizedText);
  },
  requestUserData: () => {
    ipcRenderer.send('app:request-user-data');
  },
  onUserDataLoaded: (callback: (user: any) => void) => {
    ipcRenderer.on('user-data-loaded', (event, user) => callback(user));
  },
  onChatSaved: (callback: (data: { chatId: string }) => void) => {
    ipcRenderer.on('chat-saved', (event, data) => callback(data));
  },
  signOut: () => {
    ipcRenderer.send('app:sign-out');
  },

  // ============================================
  // COMMON API
  // ============================================
  send: (channel: string, data: any) => {
    ipcRenderer.send(channel, data);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Listen for context key from main process
ipcRenderer.on('set-context-key', (event, contextKey: string) => {
  (globalThis as any).__contextKey = contextKey;
});

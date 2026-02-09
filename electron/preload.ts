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
      loadChats: () => void;
      onChatsLoaded: (callback: (data: { chats: any[] }) => void) => void;
      createChat: (title?: string) => void;
      onChatCreated: (callback: (data: { chat: any }) => void) => void;
      loadMessages: (chatId: string) => void;
      onMessagesLoaded: (callback: (data: { chatId: string; messages: any[] }) => void) => void;
      deleteChat: (chatId: string) => void;
      onChatDeleted: (callback: (data: { chatId: string }) => void) => void;
      signOut: () => void;

      // Auth API
      signUp: (data: { name: string; dob: string; email: string; password: string }) => void;
      signIn: (data: { email: string; password: string }) => void;
      checkAuth: () => void;
      onAuthStateChange: (callback: (data: { isAuthenticated: boolean; user: any }) => void) => void;
      updateProfile: (updates: any) => void;
      updatePreferences: (updates: any) => void;
      setPersonalizationPrompt: (prompt: string) => void;
      onProfileUpdated: (callback: () => void) => void;
      onPreferencesUpdated: (callback: () => void) => void;

      // Settings API
      loadSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<any>;

      // Prompt Library API
      promptLibrary: {
        getAll: () => Promise<any>;
        getCollections: () => Promise<any>;
        createCollection: (name: string, icon?: string) => Promise<any>;
        renameCollection: (collectionId: string, name: string) => Promise<any>;
        deleteCollection: (collectionId: string) => Promise<any>;
        savePrompt: (collectionId: string, title: string, content: string, metadata?: any) => Promise<any>;
        createCollectionAndSave: (collectionName: string, promptTitle: string, promptContent: string, collectionIcon?: string, metadata?: any) => Promise<any>;
        updatePrompt: (promptId: string, updates: any) => Promise<any>;
        deletePrompt: (promptId: string) => Promise<any>;
        toggleFavorite: (promptId: string) => Promise<any>;
      };
      onPromptLibraryLoaded: (callback: (data: any) => void) => void;

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
  onSetContextKey: (callback: (key: string) => void) => {
    const handler = (event: any, key: string) => callback(key);
    ipcRenderer.on('set-context-key', handler);
    return () => ipcRenderer.removeListener('set-context-key', handler);
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
  onOptimizationChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => {
    const handler = (event: any, data: any) => callback(data);
    ipcRenderer.on('optimization-chunk', handler);
    return () => ipcRenderer.removeListener('optimization-chunk', handler);
  },
  onOptimizationError: (callback: (data: { error: string }) => void) => {
    const handler = (event: any, data: any) => callback(data);
    ipcRenderer.on('optimization-error', handler);
    return () => ipcRenderer.removeListener('optimization-error', handler);
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
  loadChats: () => {
    ipcRenderer.send('app:load-chats');
  },
  onChatsLoaded: (callback: (data: { chats: any[] }) => void) => {
    ipcRenderer.on('chats-loaded', (event, data) => callback(data));
  },
  createChat: (title?: string) => {
    ipcRenderer.send('app:create-chat', title);
  },
  onChatCreated: (callback: (data: { chat: any }) => void) => {
    ipcRenderer.on('chat-created', (event, data) => callback(data));
  },
  loadMessages: (chatId: string) => {
    ipcRenderer.send('app:load-messages', chatId);
  },
  deleteChat: (chatId: string) => {
    ipcRenderer.send('app:delete-chat', chatId);
  },
  onChatDeleted: (callback: (data: { chatId: string }) => void) => {
    ipcRenderer.on('chat-deleted', (event, data) => callback(data));
  },
  onMessagesLoaded: (callback: (data: { chatId: string; messages: any[] }) => void) => {
    const handler = (event: any, data: any) => callback(data);
    ipcRenderer.on('messages-loaded', handler);
    return () => ipcRenderer.removeListener('messages-loaded', handler);
  },
  sendMessage: (data: { chatId: string | null; content: string }) => {
    ipcRenderer.send('app:send-message', data);
  },
  onMessageSent: (callback: (data: { chatId: string; chat: any; userMessage: any }) => void) => {
    const handler = (event: any, data: any) => callback(data);
    ipcRenderer.on('message-sent', handler);
    return () => ipcRenderer.removeListener('message-sent', handler);
  },
  onMessageReceived: (callback: (data: { chatId: string; message: any }) => void) => {
    const handler = (event: any, data: any) => callback(data);
    ipcRenderer.on('message-received', handler);
    return () => ipcRenderer.removeListener('message-received', handler);
  },
  onMessageSendError: (callback: (data: { error: string; details?: string }) => void) => {
    const handler = (event: any, data: any) => callback(data);
    ipcRenderer.on('message-send-error', handler);
    return () => ipcRenderer.removeListener('message-send-error', handler);
  },
  signOut: () => {
    ipcRenderer.send('app:sign-out');
  },

  // ============================================
  // AUTH API
  // ============================================
  signUp: (data: { name: string; dob: string; email: string; password: string }) => {
    ipcRenderer.send('auth:sign-up', data);
  },
  signIn: (data: { email: string; password: string }) => {
    ipcRenderer.send('auth:sign-in', data);
  },
  checkAuth: () => {
    ipcRenderer.send('auth:check');
  },
  onAuthStateChange: (callback: (data: { isAuthenticated: boolean; user: any }) => void) => {
    // Remove any existing listeners first to prevent duplicates
    ipcRenderer.removeAllListeners('auth:state-changed');
    // Add the new listener
    ipcRenderer.on('auth:state-changed', (event, data) => {
      console.log('[Preload] 📥 Auth state change event received, forwarding to renderer:', data);
      callback(data);
    });
  },
  updateProfile: (updates: any) => {
    ipcRenderer.send('user:update-profile', updates);
  },
  updatePreferences: (updates: any) => {
    ipcRenderer.send('user:update-preferences', updates);
  },
  setPersonalizationPrompt: (prompt: string) => {
    ipcRenderer.send('user:set-personalization-prompt', prompt);
  },
  onProfileUpdated: (callback: () => void) => {
    ipcRenderer.on('user:profile-updated', () => callback());
  },
  onPreferencesUpdated: (callback: () => void) => {
    ipcRenderer.on('user:preferences-updated', () => callback());
  },

  // ============================================
  // SETTINGS API
  // ============================================
  loadSettings: () => {
    return ipcRenderer.invoke('settings:load');
  },
  saveSettings: (settings: any) => {
    return ipcRenderer.invoke('settings:save', settings);
  },

  // ============================================
  // PROMPT LIBRARY API
  // ============================================
  promptLibrary: {
    getAll: () => ipcRenderer.invoke('prompt-library:get-all'),
    getCollections: () => ipcRenderer.invoke('prompt-library:get-collections'),
    createCollection: (name: string, icon?: string) =>
      ipcRenderer.invoke('prompt-library:create-collection', { name, icon }),
    renameCollection: (collectionId: string, name: string) =>
      ipcRenderer.invoke('prompt-library:rename-collection', { collectionId, name }),
    deleteCollection: (collectionId: string) =>
      ipcRenderer.invoke('prompt-library:delete-collection', { collectionId }),
    savePrompt: (collectionId: string, title: string, content: string, metadata?: any) =>
      ipcRenderer.invoke('prompt-library:save-prompt', { collectionId, title, content, metadata }),
    createCollectionAndSave: (collectionName: string, promptTitle: string, promptContent: string, collectionIcon?: string, metadata?: any) =>
      ipcRenderer.invoke('prompt-library:create-collection-and-save', {
        collectionName,
        collectionIcon,
        promptTitle,
        promptContent,
        metadata
      }),
    updatePrompt: (promptId: string, updates: any) =>
      ipcRenderer.invoke('prompt-library:update-prompt', { promptId, updates }),
    deletePrompt: (promptId: string) =>
      ipcRenderer.invoke('prompt-library:delete-prompt', { promptId }),
    toggleFavorite: (promptId: string) =>
      ipcRenderer.invoke('prompt-library:toggle-favorite', { promptId }),
  },
  onPromptLibraryLoaded: (callback: (data: any) => void) => {
    ipcRenderer.on('prompt-library:loaded', (event, data) => callback(data));
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

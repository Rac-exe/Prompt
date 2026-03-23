import { contextBridge, ipcRenderer } from 'electron';

// Declare window type for TypeScript
declare global {
  interface Window {
    electronAPI: {
      // ============================================
      // OVERLAY API (for overlay.html)
      // ============================================
      overlay: {
        optimize: (data: { text: string; isRegenerate?: boolean; mode?: string; attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>; forcedSkill?: string; userGroupId?: string; userVersionIndex?: number; assistantGroupId?: string; assistantVersionIndex?: number }) => void;
        save: (data: { title: string; content: string; collectionId?: string }) => Promise<any>;
        copy: (text: string) => void;
        close: () => void;
        openApp: () => void;
        insert: (text: string) => Promise<{ success: boolean; fallback?: string }>;
        checkAuth: () => Promise<{ isAuthenticated: boolean }>;
        getCollections: () => Promise<any>;
        createCollection: (name: string, icon?: string) => Promise<any>;
        getChats: () => Promise<Array<{ id: string; title: string }>>;
        saveToChat: (chatId: string, content: string) => Promise<{ messageId: string }>;
        onOpened: (callback: (data: { isAuthenticated: boolean }) => void) => void;
        onAuthState: (callback: (data: { isAuthenticated: boolean }) => void) => void;
        onOptimizationChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => void;
        onOptimizationComplete: (callback: (data: { original: string; optimized: string }) => void) => void;
        onOptimizationError: (callback: (data: { error: string }) => void) => void;
        getSettings: () => Promise<any>;
        onSettingsUpdate: (callback: (settings: any) => void) => void;
        newSession: () => void;
        stopGeneration: () => void;
        truncateHistory: (keepCount: number) => void;
        notifyReady: () => void;
      };

      // ============================================
      // TRANSCRIPTION API (voice input)
      // ============================================
      transcription: {
        start: (sessionId: string) => void;
        stop: () => void;
        onTranscription: (callback: (data: { text: string; accumulated: string; type: string }) => void) => void;
        onStatus: (callback: (status: string) => void) => void;
        onError: (callback: (error: string) => void) => void;
      };

      // ============================================
      // APP WINDOW API
      // ============================================
      optimizePrompt: (text: string, isRegenerate?: boolean, chatId?: string, mode?: string) => void;
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
      onOverlayMessagesAppended: (callback: (data: { chatId: string; messages: any[] }) => void) => (() => void);
      deleteChat: (chatId: string) => void;
      onChatDeleted: (callback: (data: { chatId: string }) => void) => (() => void);
      onChatDeleteError: (callback: (data: { chatId: string; error: string }) => void) => (() => void);
      renameChat: (chatId: string, title: string) => void;
      onChatRenamed: (callback: (data: { chatId: string; title: string }) => void) => (() => void);
      onChatRenameError: (callback: (data: { chatId: string; error: string }) => void) => (() => void);
      signOut: () => void;
      copyToClipboard: (text: string) => void;
      saveFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
      stopGeneration: () => void;
      onOptimizationComplete: (callback: (data: { optimized: string; original: string }) => void) => void;
      onOptimizationChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => (() => void);
      onOptimizationError: (callback: (data: { error: string }) => void) => (() => void);

      // Auth API
      signUp: (data: { name: string; dob: string; email: string; password: string }) => void;
      signIn: (data: { email: string; password: string }) => void;
      checkAuth: () => void;
      onAuthStateChange: (callback: (data: { isAuthenticated: boolean; user: any }) => void) => void;
      updateProfile: (updates: any) => void;
      uploadAvatar: (imageData: string, filename: string) => Promise<{ success: boolean; url?: string; error?: string }>;
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
        // Sharing
        getShareLink: (collectionId: string) => Promise<{ shareToken: string; shareUrl: string }>;
        getSharedCollection: (token: string) => Promise<any>;
        saveSharedCollection: (originalCollectionId: string) => Promise<{ collection: any; alreadyExisted: boolean }>;
        // Prompt sharing
        getPromptShareLink: (promptId: string) => Promise<{ shareToken: string; shareUrl: string }>;
        getSharedPrompt: (token: string) => Promise<any>;
      };
      onPromptLibraryLoaded: (callback: (data: any) => void) => void;

      // Window controls (frameless window)
      windowControls: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };

      // Common API
      send: (channel: string, data: any) => void;

      // Network status
      onNetworkStatus: (callback: (data: { isOnline: boolean }) => void) => void;
      onNetworkReconnected: (callback: () => void) => void;

      // Storage API (file attachments)
      storage: {
        getSignedUrl: (storagePath: string) => Promise<{ signedUrl?: string; error?: string }>;
        openPdf: (storagePath: string) => Promise<{ success: boolean; error?: string }>;
      };

      // Memory API
      memory: {
        get: () => Promise<{
          user: Record<string, { key: string; value: string; source: string; confidence: number; memory_type: string; updated_at: string; observation_count?: number }>;
          behavioral: Record<string, { key: string; value: string; source: string; confidence: number; memory_type: string; updated_at: string; observation_count?: number }>;
          context: Record<string, { key: string; value: string; source: string; confidence: number; memory_type: string; updated_at: string; observation_count?: number }>;
        }>;
        upsert: (data: { memoryType: 'user' | 'behavioral' | 'context'; key: string; value: string; source?: 'inferred' | 'explicit'; confidence?: number }) => Promise<{ success: boolean; error?: string }>;
        delete: (data: { memoryType: 'user' | 'behavioral' | 'context'; key: string }) => Promise<{ success: boolean; error?: string }>;
        getEnabled: () => Promise<boolean>;
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
        onUpdated: (callback: (memory: any) => void) => (() => void);
      };
    };
  }
}

// Expose protected methods to the renderer process
const electronAPI = {
  // ============================================
  // OVERLAY API (clean IPC contract)
  // ============================================
      overlay: {
        optimize: (data: { text: string; isRegenerate?: boolean; mode?: string; attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>; forcedSkill?: string; userGroupId?: string; userVersionIndex?: number; assistantGroupId?: string; assistantVersionIndex?: number; previousOutput?: string }) => {
          ipcRenderer.send('overlay:optimize', data);
        },
    save: (data: { title: string; content: string; collectionId?: string }) => {
      return ipcRenderer.invoke('overlay:save', data);
    },
    copy: (text: string) => {
      ipcRenderer.send('overlay:copy', { text });
    },
    close: () => {
      ipcRenderer.send('overlay:close');
    },
    openApp: () => {
      ipcRenderer.send('overlay:open-app');
    },
    insert: (text: string) => {
      return ipcRenderer.invoke('overlay:insert', { text });
    },
    checkAuth: () => {
      return ipcRenderer.invoke('overlay:check-auth');
    },
    getCollections: () => {
      return ipcRenderer.invoke('overlay:get-collections');
    },
    createCollection: (name: string, icon?: string) => {
      return ipcRenderer.invoke('overlay:create-collection', { name, icon });
    },
    getChats: () => {
      return ipcRenderer.invoke('overlay:get-chats');
    },
    saveToChat: (chatId: string, content: string) => {
      return ipcRenderer.invoke('overlay:save-to-chat', { chatId, content });
    },
    onOpened: (callback: (data: { isAuthenticated: boolean }) => void) => {
      ipcRenderer.on('overlay:opened', (_event, data) => callback(data));
    },
    onAuthState: (callback: (data: { isAuthenticated: boolean }) => void) => {
      ipcRenderer.on('overlay:auth-state', (_event, data) => callback(data));
    },
    onOptimizationChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => {
      ipcRenderer.on('overlay:optimization-chunk', (_event, data) => callback(data));
    },
    onOptimizationComplete: (callback: (data: { original: string; optimized: string }) => void) => {
      ipcRenderer.on('overlay:optimization-complete', (_event, data) => callback(data));
    },
    onOptimizationError: (callback: (data: { error: string }) => void) => {
      ipcRenderer.on('overlay:optimization-error', (_event, data) => callback(data));
    },
    onCursorPos: (callback: (data: { x: number; y: number }) => void) => {
      ipcRenderer.on('overlay:cursor-pos', (_event, data) => callback(data));
    },
    getSettings: () => {
      return ipcRenderer.invoke('overlay:get-settings');
    },
    onSettingsUpdate: (callback: (settings: any) => void) => {
      ipcRenderer.on('overlay:settings-update', (_event, settings) => callback(settings));
    },
    newSession: () => {
      ipcRenderer.send('overlay:new-session');
    },
    stopGeneration: () => {
      ipcRenderer.send('overlay:stop-generation');
    },
    truncateHistory: (keepCount: number) => {
      ipcRenderer.send('overlay:truncate-history', { keepCount });
    },
    notifyReady: () => {
      ipcRenderer.send('overlay:ready');
    },
  },

  // ============================================
  // TRANSCRIPTION API (voice input)
  // ============================================
  transcription: {
    start: (sessionId: string) => {
      ipcRenderer.send('transcription:start', sessionId);
    },
    stop: () => {
      ipcRenderer.send('transcription:stop');
    },
    onTranscription: (callback: (data: { text: string; accumulated: string; type: string }) => void) => {
      ipcRenderer.on('transcription:update', (_event, data) => callback(data));
    },
    onStatus: (callback: (status: string) => void) => {
      ipcRenderer.on('transcription:status', (_event, status) => callback(status));
    },
    onError: (callback: (error: string) => void) => {
      ipcRenderer.on('transcription:error', (_event, error) => callback(error));
    },
  },

  // ============================================
  // APP WINDOW API
  // ============================================
  optimizePrompt: (text: string, isRegenerate: boolean = false, chatId?: string, mode: string = 'fast') => {
    ipcRenderer.send('app:optimize-prompt', text, isRegenerate, chatId, mode);
  },
  saveToChat: (originalText: string, optimizedText: string) => {
    ipcRenderer.send('app:save-to-chat', originalText, optimizedText);
  },
  requestUserData: () => {
    ipcRenderer.send('app:request-user-data');
  },
  onUserDataLoaded: (callback: (user: any) => void) => {
    ipcRenderer.on('user-data-loaded', (_event, user) => callback(user));
  },
  onChatSaved: (callback: (data: { chatId: string }) => void) => {
    ipcRenderer.on('chat-saved', (_event, data) => callback(data));
  },
  loadChats: () => {
    ipcRenderer.send('app:load-chats');
  },
  onChatsLoaded: (callback: (data: { chats: any[] }) => void) => {
    ipcRenderer.on('chats-loaded', (_event, data) => callback(data));
  },
  createChat: (title?: string) => {
    ipcRenderer.send('app:create-chat', title);
  },
  onChatCreated: (callback: (data: { chat: any }) => void) => {
    ipcRenderer.on('chat-created', (_event, data) => callback(data));
  },
  loadMessages: (chatId: string) => {
    ipcRenderer.send('app:load-messages', chatId);
  },
  deleteChat: (chatId: string) => {
    ipcRenderer.send('app:delete-chat', chatId);
  },
  onChatDeleted: (callback: (data: { chatId: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat-deleted', handler);
    return () => ipcRenderer.removeListener('chat-deleted', handler);
  },
  onChatDeleteError: (callback: (data: { chatId: string; error: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat-delete-error', handler);
    return () => ipcRenderer.removeListener('chat-delete-error', handler);
  },
  renameChat: (chatId: string, title: string) => {
    ipcRenderer.send('app:rename-chat', { chatId, title });
  },
  onChatRenamed: (callback: (data: { chatId: string; title: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat-renamed', handler);
    return () => ipcRenderer.removeListener('chat-renamed', handler);
  },
  onChatRenameError: (callback: (data: { chatId: string; error: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat-rename-error', handler);
    return () => ipcRenderer.removeListener('chat-rename-error', handler);
  },
  onMessagesLoaded: (callback: (data: { chatId: string; messages: any[] }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('messages-loaded', handler);
    return () => ipcRenderer.removeListener('messages-loaded', handler);
  },
  onOverlayMessagesAppended: (callback: (data: { chatId: string; messages: any[] }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('overlay:messages-appended', handler);
    return () => ipcRenderer.removeListener('overlay:messages-appended', handler);
  },
  sendMessage: (data: { 
    chatId: string | null; 
    content: string; 
    mode?: string;
    attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>;
    forcedSkill?: string | null;
    groupId?: string;
    versionIndex?: number;
  }) => {
    ipcRenderer.send('app:send-message', data);
  },
  regenerateResponse: (data: {
    chatId: string;
    content: string;
    mode?: string;
    groupId?: string;
    versionIndex?: number;
    attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>;
    forcedSkill?: string | null;
    previousContent?: string;
  }) => {
    ipcRenderer.send('app:regenerate-response', data);
  },
  onMessageSent: (callback: (data: { chatId: string; chat: any; userMessage: any }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('message-sent', handler);
    return () => ipcRenderer.removeListener('message-sent', handler);
  },
  onMessageReceived: (callback: (data: { chatId: string; message: any }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('message-received', handler);
    return () => ipcRenderer.removeListener('message-received', handler);
  },
  onMessageSendError: (callback: (data: { error: string; details?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('message-send-error', handler);
    return () => ipcRenderer.removeListener('message-send-error', handler);
  },
  onSendMessageQueued: (callback: (data: { chatId: string; content: string; message: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('send-message-queued', handler);
    return () => ipcRenderer.removeListener('send-message-queued', handler);
  },
  onOfflineMessageSynced: (callback: (data: { chatId: string; userMessage: any; assistantMessage: any }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('offline-message-synced', handler);
    return () => ipcRenderer.removeListener('offline-message-synced', handler);
  },
  copyToClipboard: (text: string) => {
    ipcRenderer.send('app:copy-to-clipboard', text);
  },
  saveFeedback: (messageId: string, rating: 'positive' | 'negative') => {
    ipcRenderer.send('app:save-feedback', { messageId, rating });
  },
  stopGeneration: () => {
    ipcRenderer.send('app:stop-generation');
  },
  signOut: () => {
    ipcRenderer.send('app:sign-out');
  },

  // Streaming optimization (app window uses these channels)
  onOptimizationComplete: (callback: (data: { optimized: string; original: string }) => void) => {
    ipcRenderer.on('optimization-complete', (_event, data) => callback(data));
  },
  onOptimizationChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('optimization-chunk', handler);
    return () => ipcRenderer.removeListener('optimization-chunk', handler);
  },
  onOptimizationError: (callback: (data: { error: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('optimization-error', handler);
    return () => ipcRenderer.removeListener('optimization-error', handler);
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
    ipcRenderer.removeAllListeners('auth:state-changed');
    ipcRenderer.on('auth:state-changed', (_event, data) => {
      callback(data);
    });
  },
  updateProfile: (updates: any) => {
    ipcRenderer.send('user:update-profile', updates);
  },
  uploadAvatar: (imageData: string, filename: string) => {
    return ipcRenderer.invoke('avatar:upload', { imageData, filename });
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
    // Sharing
    getShareLink: (collectionId: string) =>
      ipcRenderer.invoke('prompt-library:get-share-link', { collectionId }),
    getSharedCollection: (token: string) =>
      ipcRenderer.invoke('prompt-library:get-shared-collection', { token }),
    saveSharedCollection: (originalCollectionId: string) =>
      ipcRenderer.invoke('prompt-library:save-shared-collection', { originalCollectionId }),
    // Prompt sharing
    getPromptShareLink: (promptId: string) =>
      ipcRenderer.invoke('prompt-library:get-prompt-share-link', { promptId }),
    getSharedPrompt: (token: string) =>
      ipcRenderer.invoke('prompt-library:get-shared-prompt', { token }),
  },
  onPromptLibraryLoaded: (callback: (data: any) => void) => {
    ipcRenderer.on('prompt-library:loaded', (_event, data) => callback(data));
  },

  // ============================================
  // WINDOW CONTROLS (frameless window)
  // ============================================
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  // ============================================
  // COMMON API
  // ============================================
  send: (channel: string, data: any) => {
    ipcRenderer.send(channel, data);
  },

  // ============================================
  // NETWORK STATUS
  // ============================================
  onNetworkStatus: (callback: (data: { isOnline: boolean }) => void) => {
    ipcRenderer.on('network:status', (_event, data) => callback(data));
  },
  onNetworkReconnected: (callback: () => void) => {
    ipcRenderer.on('network:reconnected', () => callback());
  },

  // ============================================
  // MEMORY API
  // ============================================
  memory: {
    get: () => ipcRenderer.invoke('memory:get'),
    upsert: (data: { memoryType: 'user' | 'behavioral' | 'context'; key: string; value: string; source?: 'inferred' | 'explicit'; confidence?: number }) =>
      ipcRenderer.invoke('memory:upsert', data),
    delete: (data: { memoryType: 'user' | 'behavioral' | 'context'; key: string }) =>
      ipcRenderer.invoke('memory:delete', data),
    getEnabled: () => ipcRenderer.invoke('memory:get-enabled'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('memory:set-enabled', enabled),
    onUpdated: (callback: (memory: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('memory:updated', handler);
      return () => ipcRenderer.removeListener('memory:updated', handler);
    },
  },

  // ============================================
  // STORAGE API (file attachments)
  // ============================================
  storage: {
    getSignedUrl: (storagePath: string) =>
      ipcRenderer.invoke('storage:get-signed-url', { storagePath }),
    openPdf: (storagePath: string) =>
      ipcRenderer.invoke('storage:open-pdf', { storagePath }),
  },

  // ============================================
  // SKILLS API
  // ============================================
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

/// <reference types="vite/client" />

// Electron API type declarations
interface Window {
  electronAPI?: {
    // Overlay window API (only present in overlay.html context)
    overlay?: {
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
      onOpened: (callback: (data: any) => void) => void;
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

    // Auth
    signUp: (data: { name: string; dob: string; email: string; password: string }) => void;
    signIn: (data: { email: string; password: string }) => void;
    checkAuth: () => void;
    onAuthStateChange: (callback: (data: { isAuthenticated: boolean; user: any; error?: string }) => void) => void;
    signOut: () => void;

    // Chat
    optimizePrompt: (text: string, isRegenerate?: boolean, chatId?: string, mode?: string) => void;
    saveToChat: (originalText: string, optimizedText: string) => void;
    loadChats: () => void;
    onChatsLoaded: (callback: (data: { chats: any[] }) => void) => void;
    createChat: (title?: string) => void;
    onChatCreated: (callback: (data: { chat: any }) => void) => void;
    loadMessages: (chatId: string) => void;
    onMessagesLoaded: (callback: (data: { chatId: string; messages: any[] }) => void) => void;
    sendMessage: (data: { chatId: string | null; content: string; mode?: string }) => void;
    onMessageSent: (callback: (data: { chatId: string; chat: any; userMessage: any }) => void) => void;
    onMessageReceived: (callback: (data: { chatId: string; message: any }) => void) => void;
    onMessageSendError: (callback: (data: { error: string; details?: string }) => void) => void;
    deleteChat: (chatId: string) => void;
    onChatDeleted: (callback: (data: { chatId: string }) => void) => (() => void);
    onChatDeleteError: (callback: (data: { chatId: string; error: string }) => void) => (() => void);
    renameChat: (chatId: string, title: string) => void;
    onChatRenamed: (callback: (data: { chatId: string; title: string }) => void) => (() => void);
    onChatRenameError: (callback: (data: { chatId: string; error: string }) => void) => (() => void);

    // Optimization
    onOptimizationComplete: (callback: (data: { optimized: string; original: string }) => void) => void;
    onOptimizationChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => void;
    onOptimizationError: (callback: (data: { error: string }) => void) => void;

    // Prompt Library
    promptLibrary: {
      getAll: () => Promise<any>;
      getCollections: () => Promise<any>;
      createCollection: (name: string, icon?: string) => Promise<any>;
      savePrompt: (collectionId: string, title: string, content: string, metadata?: any) => Promise<any>;
    };

    // Settings
    loadSettings: () => Promise<any>;
    saveSettings: (settings: any) => Promise<any>;

    // User
    requestUserData: () => void;
    onUserDataLoaded: (callback: (user: any) => void) => void;
    updateProfile: (updates: any) => void;
    updatePreferences: (updates: any) => void;
    setPersonalizationPrompt: (prompt: string) => void;
    onProfileUpdated: (callback: () => void) => void;
    onPreferencesUpdated: (callback: () => void) => void;

    // Transcription (Voice Input)
    transcription: {
      start: (sessionId: string) => void;
      stop: () => void;
      onTranscription: (callback: (data: { text: string; accumulated: string; type: string }) => void) => void;
      onStatus: (callback: (status: string) => void) => void;
      onError: (callback: (error: string) => void) => void;
    };

    // Sentry user sync (called from main process on login/logout)
    onSentryUser: (callback: (user: { id: string; email: string } | null) => void) => void;

    // Utility
    copyToClipboard: (text: string) => void;
    send: (channel: string, data: any) => void;
  };
}

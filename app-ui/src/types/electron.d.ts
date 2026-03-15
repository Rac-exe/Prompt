// TypeScript declarations for Electron API

export type MemoryType = 'user' | 'behavioral' | 'context';
export type MemorySource = 'inferred' | 'explicit';

export interface MemoryEntry {
  key: string;
  value: string;
  source: MemorySource;
  confidence: number;
  memory_type: MemoryType;
  updated_at: string;
}

export type UserMemoryMap = {
  user: Record<string, MemoryEntry>;
  behavioral: Record<string, MemoryEntry>;
  context: Record<string, MemoryEntry>;
};

export interface ElectronAPI {
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
    renameCollection: (collectionId: string, name: string) => Promise<any>;
    deleteCollection: (collectionId: string) => Promise<any>;
    savePrompt: (collectionId: string, title: string, content: string, metadata?: any) => Promise<any>;
    createCollectionAndSave: (collectionName: string, promptTitle: string, promptContent: string, collectionIcon?: string, metadata?: any) => Promise<any>;
    updatePrompt: (promptId: string, updates: any) => Promise<any>;
    deletePrompt: (promptId: string) => Promise<any>;
    toggleFavorite: (promptId: string) => Promise<any>;
  };
  onPromptLibraryLoaded: (callback: (data: any) => void) => void;

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

  // Utility
  copyToClipboard: (text: string) => void;
  saveFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
  send: (channel: string, data: any) => void;

  // Window controls
  windowControls: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };

  // Network status
  onNetworkStatus: (callback: (data: { isOnline: boolean }) => void) => void;
  onNetworkReconnected: (callback: () => void) => void;

  // Memory
  memory: {
    get: () => Promise<UserMemoryMap>;
    upsert: (data: { memoryType: MemoryType; key: string; value: string; source?: MemorySource; confidence?: number }) => Promise<{ success: boolean; error?: string }>;
    delete: (data: { memoryType: MemoryType; key: string }) => Promise<{ success: boolean; error?: string }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export { };

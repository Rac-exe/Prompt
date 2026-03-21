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

// ── File Attachments ──────────────────────────────────────────────────────────
export interface AttachedFile {
  name: string;
  mimeType: string;
  base64: string;
  sizeBytes: number;
}

// ── Skills ────────────────────────────────────────────────────────────────────
export interface SkillInfo {
  name: string;
  label: string;
  description: string;
}

export interface SharedCollectionView {
  id: string;
  name: string;
  icon?: string;
  share_token: string;
  owner_name: string;
  owner_id: string;
  prompts: Array<{
    id: string;
    title: string;
    content: string;
    collection_id: string;
    created_at: string;
  }>;
}

export interface SharedPromptView {
  id: string;
  title: string;
  content: string;
  share_token: string;
  owner_name: string;
  owner_id: string;
  created_at: string;
}

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
  onOverlayMessagesAppended: (callback: (data: { chatId: string; messages: any[] }) => void) => (() => void);
  sendMessage: (data: { 
    chatId: string | null; 
    content: string; 
    mode?: string;
    attachedFiles?: AttachedFile[];
    forcedSkill?: string | null;
    groupId?: string;
    versionIndex?: number;
  }) => void;
  regenerateResponse: (data: {
    chatId: string;
    content: string;
    mode?: string;
    groupId?: string;
    versionIndex?: number;
    attachedFiles?: AttachedFile[];
    forcedSkill?: string | null;
    previousContent?: string;
  }) => void;
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
    // Sharing
    getShareLink: (collectionId: string) => Promise<{ shareToken: string; shareUrl: string }>;
    getSharedCollection: (token: string) => Promise<SharedCollectionView>;
    saveSharedCollection: (originalCollectionId: string) => Promise<{ collection: any; alreadyExisted: boolean }>;
    // Prompt sharing
    getPromptShareLink: (promptId: string) => Promise<{ shareToken: string; shareUrl: string }>;
    getSharedPrompt: (token: string) => Promise<SharedPromptView>;
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
  stopGeneration: () => void;

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

  // Skills
  skills: {
    list: () => Promise<SkillInfo[]>;
  };

  // Stop generation
  stopGeneration: () => void;

  // Overlay (available when running inside the overlay renderer)
  overlay?: {
    optimize: (data: {
      text: string;
      isRegenerate?: boolean;
      mode?: string;
      chatId?: string;
      attachedFiles?: AttachedFile[];
      forcedSkill?: string;
      userGroupId?: string;
      userVersionIndex?: number;
      assistantGroupId?: string;
      assistantVersionIndex?: number;
      previousOutput?: string;
    }) => void;
    save: (data: { title: string; content: string; collectionId?: string }) => Promise<any>;
    copy: (text: string) => void;
    close: () => void;
    openApp: () => void;
    insert: (text: string) => Promise<any>;
    checkAuth: () => Promise<{ isAuthenticated: boolean }>;
    getCollections: () => Promise<any[]>;
    createCollection: (name: string, icon?: string) => Promise<any>;
    getChats: () => Promise<any[]>;
    saveToChat: (chatId: string, content: string) => Promise<any>;
    onOpened: (callback: (data: any) => void) => void;
    onAuthState: (callback: (data: { isAuthenticated: boolean }) => void) => void;
    onOptimizationChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => void;
    onOptimizationComplete: (callback: (data: { original: string; optimized: string }) => void) => void;
    onOptimizationError: (callback: (data: { error: string }) => void) => void;
    onCursorPos: (callback: (data: { x: number; y: number }) => void) => void;
    getSettings: () => Promise<any>;
    onSettingsUpdate: (callback: (settings: any) => void) => void;
    newSession: () => void;
    stopGeneration: () => void;
    truncateHistory: (keepCount: number) => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export { };

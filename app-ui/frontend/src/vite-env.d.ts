/// <reference types="vite/client" />

// Electron API type declarations
interface Window {
  electronAPI?: {
    // Optimization API
    optimizePrompt: (text: string, isRegenerate?: boolean) => void;
    onOptimizationComplete: (callback: (data: { optimized: string; original: string }) => void) => void;

    // Chat API
    saveToChat: (originalText: string, optimizedText: string) => void;
    loadChats: () => void;
    onChatsLoaded: (callback: (data: { chats: any[] }) => void) => void;
    createChat: (title?: string) => void;
    onChatCreated: (callback: (data: { chat: any }) => void) => void;
    loadMessages: (chatId: string) => void;
    onMessagesLoaded: (callback: (data: { chatId: string; messages: any[] }) => void) => void;

    // User API
    requestUserData: () => void;
    onUserDataLoaded: (callback: (user: any) => void) => void;
    signOut: () => void;

    // Common API
    send: (channel: string, data: any) => void;
  };
}

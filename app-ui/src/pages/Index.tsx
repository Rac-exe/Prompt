import { useState, useCallback, useMemo, useEffect } from "react";
import { LoginPage } from "@/components/auth/LoginPage";
import { AppLayout } from "@/components/layout/AppLayout";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatView } from "@/components/chat/ChatView";
import { SavePromptModal } from "@/components/chat/SavePromptModal";
import { PromptLibrary, Collection } from "@/components/library/PromptLibrary";
import { SavedPrompt } from "@/components/library/PromptCard";
import { HistoryView, HistoryItem } from "@/components/history/HistoryView";
import { SettingsView } from "@/components/settings/SettingsView";
import { Message } from "@/components/chat/MessageBubble";
import { PromptPreviewModal } from "@/components/library/PromptPreviewModal";
import { toast } from "@/hooks/use-toast";

// Empty initial data
const initialRecentChats: { id: string; title: string; date: string }[] = [];

const initialCollections: Collection[] = [
  { id: "all", name: "All Prompts", isDefault: true, icon: "all" },
  { id: "favorites", name: "Favorites", isDefault: true, icon: "favorites" },
];

const initialPrompts: SavedPrompt[] = [];

// Store chat sessions for history
interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

// Check if running in Electron environment
const isElectron = typeof window !== 'undefined' && window.electronAPI;

const Index = () => {
  // User state (auth is handled by AuthWrapper)
  const [userEmail, setUserEmail] = useState("user@example.com");

  // Navigation state
  const [currentView, setCurrentView] = useState<"chat" | "library" | "settings">("chat");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState<any[]>([]);

  // Chat sessions for history
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedPromptIds, setSavedPromptIds] = useState<string[]>([]);
  const [currentChatTitle, setCurrentChatTitle] = useState<string>('');

  // Save modal state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [promptToSave, setPromptToSave] = useState<Message | null>(null);

  // Preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [promptToPreview, setPromptToPreview] = useState<SavedPrompt | null>(null);

  // Library state
  const [collections, setCollections] = useState<Collection[]>(initialCollections);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(initialPrompts);

  // Initialize theme on mount (Fix 1)
  useEffect(() => {
    const STORAGE_KEY = "prompt-weaver-settings";
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const settings = JSON.parse(stored);
        if (settings.theme === "dark") {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      } catch (e) {
        document.documentElement.classList.add("dark");
      }
    } else {
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Load chats from Supabase on mount
  useEffect(() => {
    if (isElectron && window.electronAPI?.loadChats) {
      console.log('[Index] Loading chats from Supabase');
      window.electronAPI.loadChats();
    }
  }, []);

  // Listen for chats loaded from Supabase
  useEffect(() => {
    if (isElectron && window.electronAPI?.onChatsLoaded) {
      const handleChatsLoaded = (data: { chats: any[] }) => {
        console.log('[Index] Chats loaded from Supabase:', data.chats.length);
        const formattedChats = data.chats.map(chat => ({
          id: chat.id,
          title: chat.title,
          date: new Date(chat.updated_at).toLocaleDateString(),
        }));
        setRecentChats(formattedChats);
      };

      window.electronAPI.onChatsLoaded(handleChatsLoaded);
    }
  }, []);

  // Listen for message send confirmation (user message saved to DB)
  useEffect(() => {
    if (isElectron && window.electronAPI?.onMessageSent) {
      const handleMessageSent = (data: { chatId: string; chat: any; userMessage: any }) => {
        console.log('[Index] Message sent to Supabase:', data);

        // Update selected chat ID if this was a new chat
        if (!selectedChatId) {
          setSelectedChatId(data.chatId);
          setCurrentChatTitle(data.chat.title);
        }

        // Add user message to local state
        const userMessage: Message = {
          id: data.userMessage.id,
          role: "user",
          content: data.userMessage.content,
          timestamp: new Date(data.userMessage.createdAt),
        };
        setMessages((prev) => [...prev, userMessage]);

        // Show generating indicator
        setIsGenerating(true);
      };

      window.electronAPI.onMessageSent(handleMessageSent);
    }
  }, [selectedChatId]);

  // Listen for assistant response (optimization result saved to DB)
  useEffect(() => {
    if (isElectron && window.electronAPI?.onMessageReceived) {
      const handleMessageReceived = (data: { chatId: string; message: any }) => {
        console.log('[Index] Assistant message received:', data);

        const assistantMessage: Message = {
          id: data.message.id,
          role: "assistant",
          content: data.message.content,
          timestamp: new Date(data.message.createdAt),
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setIsGenerating(false);
      };

      window.electronAPI.onMessageReceived(handleMessageReceived);
    }
  }, []);

  // Listen for message send errors
  useEffect(() => {
    if (isElectron && window.electronAPI?.onMessageSendError) {
      const handleMessageSendError = (data: { error: string; details?: string }) => {
        console.error('[Index] Message send error:', data);
        setIsGenerating(false);
        toast({
          title: "Failed to send message",
          description: data.error,
          variant: "destructive",
        });
      };

      window.electronAPI.onMessageSendError(handleMessageSendError);
    }
  }, []);

  // Load messages from Supabase when a chat is selected
  useEffect(() => {
    if (selectedChatId && isElectron && window.electronAPI?.loadMessages) {
      console.log('[Index] Loading messages for chat:', selectedChatId);
      window.electronAPI.loadMessages(selectedChatId);
      setCurrentView("chat");

      // Find chat title
      const chat = recentChats.find((c) => c.id === selectedChatId);
      if (chat) {
        setCurrentChatTitle(chat.title);
      }
    }
  }, [selectedChatId, recentChats]);

  // Listen for messages loaded from Supabase
  useEffect(() => {
    if (isElectron && window.electronAPI?.onMessagesLoaded) {
      const handleMessagesLoaded = (data: { chatId: string; messages: any[] }) => {
        console.log('[Index] Messages loaded from Supabase:', data.messages.length);

        if (data.chatId === selectedChatId) {
          const formattedMessages: Message[] = data.messages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.created_at),
          }));
          setMessages(formattedMessages);
        }
      };

      window.electronAPI.onMessagesLoaded(handleMessagesLoaded);
    }
  }, [selectedChatId]);

  // Generate history from chat sessions (sorted by most recent)
  const history = useMemo((): HistoryItem[] => {
    return chatSessions
      .map((session) => ({
        id: session.id,
        title: session.title,
        preview: session.messages[0]?.content || "",
        date: session.createdAt,
        messageCount: session.messages.length,
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [chatSessions]);

  // Auth handlers
  const handleLogout = () => {
    // Clear local state
    setUserEmail("");
    setMessages([]);
    setRecentChats([]);
    setChatSessions([]);
    setSavedPrompts([]);
    setCurrentView("chat");

    // Sign out via Electron (AuthWrapper will handle UI transition)
    if (isElectron && window.electronAPI?.signOut) {
      window.electronAPI.signOut();
    }

    toast({
      title: "Signed out",
      description: "Please log in again.",
    });
  };

  // Chat handlers
  const handleNewChat = () => {
    console.log('[Index] Starting new chat');
    // Clear current chat selection and messages
    setMessages([]);
    setSelectedChatId(null);
    setCurrentChatTitle('');
    setCurrentView("chat");
  };

  const handleSendMessage = useCallback((content: string) => {
    console.log('[Index] Sending message:', {
      chatId: selectedChatId,
      contentLength: content.length
    });

    // Use new unified send-message API that handles everything
    if (isElectron && window.electronAPI?.sendMessage) {
      // Send via IPC - this will:
      // 1. Create chat if needed (chatId is null)
      // 2. Save user message to DB
      // 3. Trigger optimization
      // 4. Save assistant message to DB
      // 5. Notify renderer via events
      window.electronAPI.sendMessage({
        chatId: selectedChatId,
        content: content
      });

      console.log('[Index] Message sent to Electron main process');
    } else {
      // Fallback for web environment (no Electron)
      console.warn('[Index] Running in web mode - no Electron API');

      const userMessage: Message = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsGenerating(true);

      setTimeout(() => {
        const fallbackResponse = `⚠️ Running in web mode - Electron API not available. Please run this app in Electron to use the AI-powered prompt optimization with adaptive system prompts.

Your prompt was: "${content}"`;

        const assistantMessage: Message = {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: fallbackResponse,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setIsGenerating(false);
      }, 500);
    }
  }, [selectedChatId]);

  const handleCopyPrompt = (id: string) => {
    toast({
      title: "Copied!",
      description: "Prompt copied to clipboard.",
    });
  };

  const handleSavePromptClick = (id: string) => {
    const message = messages.find((m) => m.id === id);
    if (message) {
      setPromptToSave(message);
      setSaveModalOpen(true);
    }
  };

  const handleFeedback = (messageId: string, rating: "positive" | "negative") => {
    console.log('[Index] Feedback received:', { messageId, rating });

    // Store feedback in localStorage for now (can be sent to Supabase later)
    const feedbackKey = `feedback-${messageId}`;
    localStorage.setItem(feedbackKey, JSON.stringify({
      messageId,
      rating,
      timestamp: new Date().toISOString()
    }));

    toast({
      title: "Thank you!",
      description: "Your feedback helps us improve.",
    });
  };

  const handleSavePrompt = (collectionId: string, title: string, newCollectionName?: string) => {
    if (!promptToSave) return;

    let targetCollectionId = collectionId;

    // Create new collection if needed
    if (collectionId === "new" && newCollectionName) {
      const newCollection: Collection = {
        id: `col-${Date.now()}`,
        name: newCollectionName,
        icon: "folder",
      };
      setCollections((prev) => [...prev, newCollection]);
      targetCollectionId = newCollection.id;
    }

    // Save the prompt with user-provided title
    const newPrompt: SavedPrompt = {
      id: `prompt-${Date.now()}`,
      title: title,
      content: promptToSave.content,
      collectionId: targetCollectionId,
      sourceChat: recentChats.find((c) => c.id === selectedChatId)?.title,
      createdAt: new Date(),
    };

    setSavedPrompts((prev) => [newPrompt, ...prev]);
    setSavedPromptIds((prev) => [...prev, promptToSave.id]);

    toast({
      title: "Saved!",
      description: "Prompt saved to your library.",
    });

    setSaveModalOpen(false);
    setPromptToSave(null);
  };

  // Library handlers
  const handleCreateCollection = (name: string) => {
    const newCollection: Collection = {
      id: `col-${Date.now()}`,
      name,
      icon: "folder",
    };
    setCollections((prev) => [...prev, newCollection]);
    toast({
      title: "Collection created",
      description: `"${name}" has been created.`,
    });
  };

  const handleRenameCollection = (id: string, name: string) => {
    setCollections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name } : c))
    );
    toast({
      title: "Collection renamed",
      description: `Collection renamed to "${name}".`,
    });
  };

  const handleDeleteCollection = (id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id));
    // Move prompts to "all"
    setSavedPrompts((prev) =>
      prev.map((p) => (p.collectionId === id ? { ...p, collectionId: "all" } : p))
    );
    toast({
      title: "Collection deleted",
      description: "Prompts moved to All Prompts.",
    });
  };

  const handleCopyLibraryPrompt = (id: string) => {
    const prompt = savedPrompts.find((p) => p.id === id);
    if (prompt) {
      navigator.clipboard.writeText(prompt.content);
      toast({
        title: "Copied!",
        description: "Prompt copied to clipboard.",
      });
    }
  };

  const handleEditPrompt = (id: string) => {
    toast({
      title: "Edit mode",
      description: "Prompt editing UI would open here.",
    });
  };

  const handleDeletePrompt = (id: string) => {
    setSavedPrompts((prev) => prev.filter((p) => p.id !== id));
    toast({
      title: "Deleted",
      description: "Prompt has been removed.",
    });
  };

  // History handlers
  const handleSelectHistoryItem = (id: string) => {
    const session = chatSessions.find((s) => s.id === id);
    if (session) {
      // Restore the conversation
      setMessages(session.messages);
      setSelectedChatId(session.id);
      setCurrentView("chat");
      toast({
        title: "Chat restored",
        description: `Loaded "${session.title}"`,
      });
    }
  };

  // Library handler - show prompt preview
  const handleOpenPrompt = (id: string) => {
    const prompt = savedPrompts.find((p) => p.id === id);
    if (prompt) {
      setPromptToPreview(prompt);
      setPreviewModalOpen(true);
    }
  };

  // Render current view (auth is handled by AuthWrapper, so we're always authenticated here)
  const renderView = () => {
    switch (currentView) {
      case "library":
        return (
          <PromptLibrary
            collections={collections}
            prompts={savedPrompts}
            onCreateCollection={handleCreateCollection}
            onRenameCollection={handleRenameCollection}
            onDeleteCollection={handleDeleteCollection}
            onCopyPrompt={handleCopyLibraryPrompt}
            onEditPrompt={handleEditPrompt}
            onDeletePrompt={handleDeletePrompt}
            onOpenPrompt={handleOpenPrompt}
          />
        );
      case "history":
        return (
          <HistoryView
            items={history}
            onSelectItem={handleSelectHistoryItem}
          />
        );
      case "settings":
        return (
          <SettingsView
            userEmail={userEmail}
            onLogout={handleLogout}
          />
        );
      case "chat":
      default:
        return (
          <ChatView
            messages={messages}
            onSendMessage={handleSendMessage}
            onCopyPrompt={handleCopyPrompt}
            onSavePrompt={handleSavePromptClick}
            onFeedback={handleFeedback}
            savedPromptIds={savedPromptIds}
            isGenerating={isGenerating}
          />
        );
    }
  };

  return (
    <>
      <AppLayout
        sidebar={
          <Sidebar
            currentView={currentView}
            onViewChange={setCurrentView}
            userEmail={userEmail}
            onLogout={handleLogout}
            recentChats={recentChats}
            onSelectChat={setSelectedChatId}
            selectedChatId={selectedChatId}
            onNewChat={handleNewChat}
          />
        }
      >
        {renderView()}
      </AppLayout>

      <SavePromptModal
        open={saveModalOpen}
        onClose={() => {
          setSaveModalOpen(false);
          setPromptToSave(null);
        }}
        collections={collections.filter((c) => c.id !== "all" && c.id !== "favorites")}
        onSave={handleSavePrompt}
        promptPreview={promptToSave?.content || ""}
      />

      <PromptPreviewModal
        open={previewModalOpen}
        onOpenChange={setPreviewModalOpen}
        prompt={promptToPreview || { title: "", content: "" }}
      />
    </>
  );
};

export default Index;

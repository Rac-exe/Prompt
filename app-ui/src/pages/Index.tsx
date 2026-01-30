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
  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  // Navigation state
  const [currentView, setCurrentView] = useState<"chat" | "library" | "settings">("chat");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState(initialRecentChats);

  // Chat sessions for history
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedPromptIds, setSavedPromptIds] = useState<string[]>([]);

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

  // Listen for optimization results from Electron
  useEffect(() => {
    if (isElectron && window.electronAPI?.onOptimizationComplete) {
      const handleOptimizationComplete = (data: { original: string; optimized: string }) => {
        console.log('[Index] Optimization complete received:', data.original.substring(0, 50));

        const assistantMessage: Message = {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: data.optimized,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setIsGenerating(false);
      };

      window.electronAPI.onOptimizationComplete(handleOptimizationComplete);
      console.log('[Index] Registered optimization complete listener');
    }
  }, []);

  // Load messages when a chat is selected (Fix 4: Recent chat navigation)
  useEffect(() => {
    if (selectedChatId) {
      const chatSession = chatSessions.find((s) => s.id === selectedChatId);
      if (chatSession) {
        setMessages(chatSession.messages);
        setCurrentView("chat");
      }
    }
  }, [selectedChatId, chatSessions]);

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
  const handleLogin = (email: string) => {
    setUserEmail(email);
    setIsLoggedIn(true);
    toast({
      title: "Welcome back!",
      description: "You've successfully signed in.",
    });
  };

  const handleLogout = () => {
    // Fix 10: Don't close app, just redirect to login
    setUserEmail("");
    setMessages([]);
    setRecentChats([]);
    setChatSessions([]);
    setSavedPrompts([]);
    setCurrentView("chat");
    setIsLoggedIn(false); // This will show login page
    toast({
      title: "Signed out",
      description: "Please log in again.",
    });
  };

  // Chat handlers
  const handleNewChat = () => {
    // Save current chat to history if it has messages
    if (messages.length > 0 && selectedChatId) {
      const currentChat = recentChats.find((c) => c.id === selectedChatId);
      if (currentChat) {
        setChatSessions((prev) => {
          // Don't duplicate
          if (prev.find((s) => s.id === selectedChatId)) {
            return prev;
          }
          return [
            {
              id: selectedChatId,
              title: currentChat.title,
              messages,
              createdAt: new Date(),
            },
            ...prev,
          ];
        });
      }
    }
    setMessages([]);
    setSelectedChatId(null);
    setCurrentView("chat");
  };

  const handleSendMessage = useCallback((content: string) => {
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date(),
    };

    // Add to recent chats BEFORE generating (prevents duplication)
    let currentChatId = selectedChatId;
    if (!currentChatId) {
      const newChatId = `chat-${Date.now()}`;
      const newChat = {
        id: newChatId,
        title: content.slice(0, 30) + (content.length > 30 ? "..." : ""),
        date: "Today",
      };
      setRecentChats((prev) => [newChat, ...prev]);
      setSelectedChatId(newChatId);
      currentChatId = newChatId;
    }

    setMessages((prev) => [...prev, userMessage]);
    setIsGenerating(true);

    // Use Electron API for optimization if available
    if (isElectron && window.electronAPI?.optimizePrompt) {
      // Call the Python service via Electron IPC
      window.electronAPI.optimizePrompt(content, false);
    } else {
      // Fallback for web environment (no Electron)
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

  // Not logged in - show login page
  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // Render current view
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

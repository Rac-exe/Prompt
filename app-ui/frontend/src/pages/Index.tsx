import { useState, useCallback, useMemo, useEffect } from "react";
import { LoginPage } from "@/components/auth/LoginPage.tsx";
import { AppLayout } from "@/components/layout/AppLayout.tsx";
import { Sidebar } from "@/components/layout/Sidebar.tsx";
import { ChatView } from "@/components/chat/ChatView.tsx";
import { SavePromptModal } from "@/components/chat/SavePromptModal.tsx";
import { PromptLibrary, Collection } from "@/components/library/PromptLibrary.tsx";
import { SavedPrompt } from "@/components/library/PromptCard.tsx";
import { HistoryView, HistoryItem } from "@/components/history/HistoryView.tsx";
import { SettingsView } from "@/components/settings/SettingsViewV2.tsx";
import { Message } from "@/components/chat/MessageBubble.tsx";
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
  const [isLoadingChats, setIsLoadingChats] = useState(false);

  // Chat sessions for history
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  
  // Help handler
  const handleOpenHelp = () => {
    window.open("https://docs.promptweaver.app", "_blank");
  };

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

        setMessages((prev) => {
          const updated = [...prev, assistantMessage];

          // Add to recent chats if new
          if (!selectedChatId) {
            const newChat = {
              id: `chat-${Date.now()}`,
              title: data.original.slice(0, 30) + (data.original.length > 30 ? "..." : ""),
              date: "Today",
            };
            setRecentChats((prevChats) => [newChat, ...prevChats]);
            setSelectedChatId(newChat.id);
          }

          return updated;
        });
        setIsGenerating(false);
      };

      window.electronAPI.onOptimizationComplete(handleOptimizationComplete);
      console.log('[Index] Registered optimization complete listener');
    }
  }, [selectedChatId]);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedPromptIds, setSavedPromptIds] = useState<string[]>([]);

  // Save modal state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [promptToSave, setPromptToSave] = useState<Message | null>(null);

  // Library state
  const [collections, setCollections] = useState<Collection[]>(initialCollections);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(initialPrompts);

  // Generate history from chat sessions (sorted by most recent)
  // Note: History removed from UI as per requirements
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
    setIsLoggedIn(false);
    setUserEmail("");
    setMessages([]);
    setCurrentView("chat");
    toast({
      title: "Signed out",
      description: "You've been signed out successfully.",
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
          id: `msg-${Date.now() + 1}`,
          role: "assistant",
          content: fallbackResponse,
          timestamp: new Date(),
        };

        setMessages((prev) => {
          const updated = [...prev, assistantMessage];

          // Add to recent chats if new
          if (!selectedChatId) {
            const newChat = {
              id: `chat-${Date.now()}`,
              title: content.slice(0, 30) + (content.length > 30 ? "..." : ""),
              date: "Today",
            };
            setRecentChats((prev) => [newChat, ...prev]);
            setSelectedChatId(newChat.id);
          }

          return updated;
        });
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

  // Library handler - open prompt in chat
  const handleOpenPrompt = (id: string) => {
    const prompt = savedPrompts.find((p) => p.id === id);
    if (prompt) {
      // Create a new chat with this prompt
      handleNewChat();
      setTimeout(() => {
        handleSendMessage(prompt.content);
      }, 100);
      toast({
        title: "Prompt loaded",
        description: `Opening "${prompt.title}"`,
      });
    }
  };
  
  // Close settings
  const handleCloseSettings = () => {
    setCurrentView("chat");
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
      case "settings":
        return (
          <SettingsView
            userEmail={userEmail}
            onLogout={handleLogout}
            onClose={handleCloseSettings}
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
            onOpenHelp={handleOpenHelp}
            recentChats={recentChats}
            onSelectChat={setSelectedChatId}
            selectedChatId={selectedChatId}
            onNewChat={handleNewChat}
            isLoadingChats={isLoadingChats}
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
    </>
  );
};

export default Index;

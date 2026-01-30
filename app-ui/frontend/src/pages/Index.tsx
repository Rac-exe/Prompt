import { useState, useCallback, useMemo } from "react";
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

const optimizedResponses = [
  `I've enhanced your prompt for maximum clarity and effectiveness:

**Optimized Prompt:**
"You are an expert content strategist with 10+ years of experience. Create a comprehensive, SEO-optimized blog post on [TOPIC]. 

Requirements:
- Compelling headline using power words
- Meta description (150-160 chars)
- Introduction with a hook
- 3-5 H2 sections with supporting H3s
- Naturally integrated primary and secondary keywords
- Actionable conclusion with CTA

Tone: Professional yet conversational
Word count: 1,500-2,000 words"`,
  `Here's your optimized prompt with enhanced specificity:

**Optimized Prompt:**
"Act as a senior software engineer documenting a production codebase. Generate comprehensive JSDoc documentation for the following code.

Include:
1. Function/class purpose (1-2 sentences)
2. @param descriptions with types and constraints
3. @returns with type and possible values
4. @throws for error conditions
5. @example with 2-3 usage scenarios
6. @see for related functions

Style: Technical but accessible
Format: JSDoc 3.x compatible"`,
  `I've transformed your prompt for better results:

**Optimized Prompt:**
"You are a conversion copywriter specializing in e-commerce. Write a high-converting product description for [PRODUCT].

Structure:
- Opening hook addressing primary pain point
- 3 key benefits (feature → benefit → emotion)
- Social proof placeholder
- Urgency element
- Clear CTA

Constraints:
- Maximum 150 words
- Reading level: 8th grade
- Include sensory language"`,
];

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

    // Simulate AI response
    setTimeout(() => {
      const responseIndex = Math.floor(Math.random() * optimizedResponses.length);
      const assistantMessage: Message = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: optimizedResponses[responseIndex],
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
    }, 1500);
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

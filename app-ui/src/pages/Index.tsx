import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
import { useInitializeSettings } from "@/hooks/useInitializeSettings";
import { useSmoothStreaming } from "@/hooks/useSmoothStreaming";
import { useAuth } from "@/context/AuthContext";

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
  // Initialize settings after authentication
  useInitializeSettings();

  const { user, signOut } = useAuth();

  // Navigation state
  const [currentView, setCurrentView] = useState<"chat" | "library" | "settings" | "history">("chat");
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

  // Debug stats
  const [generationStats, setGenerationStats] = useState<{ ttft: number | null; total: number | null }>({ ttft: null, total: null });
  const generationStartTime = useRef<number>(0);

  // Network connectivity state
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    window.electronAPI?.onNetworkStatus?.((data) => setIsOnline(data.isOnline));
    window.electronAPI?.onNetworkReconnected?.(() => setIsOnline(true));
  }, []);

  // Offline uncached-chat state — true when a selected chat has no cached messages while offline
  const [offlineChatUnavailable, setOfflineChatUnavailable] = useState(false);

  // Send error state — shown inline in the input bar instead of a toast
  const [sendError, setSendError] = useState<string | null>(null);

  // Preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [promptToPreview, setPromptToPreview] = useState<SavedPrompt | null>(null);

  // Library state
  const [collections, setCollections] = useState<Collection[]>(initialCollections);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(initialPrompts);

  // Helper: transform raw Supabase data into local state shape
  const mapCollections = (raw: any[]) => raw.map((c: any) => ({
    id: c.id,
    name: c.name,
    icon: c.icon || 'folder',
  }));

  const mapPrompts = (raw: any[]) => raw.map((p: any) => ({
    id: p.id,
    title: p.title,
    content: p.content,
    collectionId: p.collection_id,
    sourceChat: p.metadata?.source_chat,
    createdAt: new Date(p.created_at),
  }));

  // Load prompt library from Supabase on mount
  useEffect(() => {
    if (isElectron && window.electronAPI?.promptLibrary) {
      // Load collections
      window.electronAPI.promptLibrary.getCollections()
        .then((collections) => {
          console.log('[Index] Loaded collections from Supabase:', collections.length);
          setCollections(mapCollections(collections));
        })
        .catch((error) => console.error('[Index] Error loading collections:', error));

      // Load prompts
      window.electronAPI.promptLibrary.getAll()
        .then((prompts) => {
          console.log('[Index] Loaded prompts from Supabase:', prompts.length);
          setSavedPrompts(mapPrompts(prompts));
        })
        .catch((error) => console.error('[Index] Error loading prompts:', error));
    }
  }, [isElectron]);

  // Listen for real-time prompt library updates from main process
  // (fired when overlay saves a prompt or collection)
  useEffect(() => {
    if (isElectron && window.electronAPI?.onPromptLibraryLoaded) {
      window.electronAPI.onPromptLibraryLoaded((data: any) => {
        console.log('[Index] prompt-library:loaded event — refreshing library');
        if (data?.collections) {
          setCollections(mapCollections(data.collections));
        }
        if (data?.prompts) {
          setSavedPrompts(mapPrompts(data.prompts));
        }
      });
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

      const cleanup = window.electronAPI.onChatsLoaded(handleChatsLoaded);
      return cleanup; // Cleanup listener on unmount
    }
  }, []);

  // Listen for chat renamed events
  useEffect(() => {
    if (isElectron && window.electronAPI?.onChatRenamed) {
      const handleChatRenamed = (data: { chatId: string; title: string }) => {
        console.log('[Index] Chat renamed:', data);
        // Update local state immediately for responsive feel
        setRecentChats(prev =>
          prev.map(c => c.id === data.chatId ? { ...c, title: data.title } : c)
        );
        // Update current chat title if we're viewing the renamed chat
        if (selectedChatId === data.chatId) {
          setCurrentChatTitle(data.title);
        }
      };
      const cleanup = window.electronAPI.onChatRenamed(handleChatRenamed);
      return cleanup;
    }
  }, [selectedChatId]);

  // Listen for chat rename errors
  useEffect(() => {
    if (isElectron && window.electronAPI?.onChatRenameError) {
      const handleRenameError = (data: { chatId: string; error: string }) => {
        console.error('[Index] Chat rename error:', data);
        toast({
          title: "Rename failed",
          description: data.error || "Failed to rename chat. Please try again.",
          variant: "destructive",
        });
      };
      const cleanup = window.electronAPI.onChatRenameError(handleRenameError);
      return cleanup;
    }
  }, []);

  // Listen for chat deleted events
  useEffect(() => {
    if (isElectron && window.electronAPI?.onChatDeleted) {
      const handleChatDeleted = (data: { chatId: string }) => {
        console.log('[Index] Chat deleted:', data);
        // Remove from local state
        setRecentChats(prev => prev.filter(c => c.id !== data.chatId));
        // If the deleted chat was selected, clear the view
        if (selectedChatId === data.chatId) {
          setSelectedChatId(null);
          setMessages([]);
          setCurrentChatTitle('');
        }
        toast({
          title: "Chat deleted",
          description: "Chat has been permanently removed.",
        });
      };
      const cleanup = window.electronAPI.onChatDeleted(handleChatDeleted);
      return cleanup;
    }
  }, [selectedChatId]);

  // Listen for chat delete errors
  useEffect(() => {
    if (isElectron && window.electronAPI?.onChatDeleteError) {
      const handleDeleteError = (data: { chatId: string; error: string }) => {
        console.error('[Index] Chat delete error:', data);
        toast({
          title: "Delete failed",
          description: data.error || "Failed to delete chat. Please try again.",
          variant: "destructive",
        });
      };
      const cleanup = window.electronAPI.onChatDeleteError(handleDeleteError);
      return cleanup;
    }
  }, []);

  const [finalMessageData, setFinalMessageData] = useState<Message | null>(null);
  const [streamedMessageId, setStreamedMessageId] = useState<string | null>(null); // Track ID of message being streamed

  // Initialize the smooth streaming hook
  const handleStreamingComplete = useCallback((finalMessage: Message) => {
    setMessages((prev) => {
      // Avoid duplicates if already added
      if (prev.some(m => m.id === finalMessage.id)) return prev;
      return [...prev, finalMessage];
    });
    setStreamedMessageId(null); // Reset filtered ID
    setIsGenerating(false);
  }, []);

  const { streamingMessage, startStreaming, handleChunk, handleFinalMessage, stopStreaming } = useSmoothStreaming({
    onStreamingComplete: handleStreamingComplete
  });

  // Stop generation: abort the backend stream and fast-flush the visual buffer.
  // The backend resolves the aborted promise with partial text, which flows
  // through the normal onMessageReceived → handleFinalMessage → animate path
  // to commit the message — so we don't force-complete here.
  const handleStopGeneration = useCallback(() => {
    window.electronAPI?.stopGeneration?.();
    stopStreaming(); // skip typewriter delay, show partial text immediately
  }, [stopStreaming]);

  // Filter history to avoid duplicates
  // We filter out the message being currently streamed from history to avoid duplicates
  // if it arrives via other means (like onMessagesLoaded) before streaming finishes.
  const displayMessages = useMemo(() => {
    return streamedMessageId
      ? messages.filter(m => m.id !== streamedMessageId)
      : messages;
  }, [messages, streamedMessageId]);

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

        // Add user message to local state, replacing any optimistic placeholder
        // that was inserted by edit/retry to prevent the empty-screen flash.
        const userMessage: Message = {
          id: data.userMessage.id,
          role: "user",
          content: data.userMessage.content,
          timestamp: new Date(data.userMessage.createdAt),
        };
        setMessages((prev) => {
          // Replace the last placeholder (id starts with 'edit-placeholder-' or 'retry-placeholder-')
          const placeholderIdx = prev.findLastIndex(
            (m) => m.id.startsWith("edit-placeholder-") || m.id.startsWith("retry-placeholder-")
          );
          if (placeholderIdx !== -1) {
            const next = [...prev];
            next[placeholderIdx] = userMessage;
            return next;
          }
          return [...prev, userMessage];
        });

        // Show generating indicator and start streaming
        setIsGenerating(true);
        generationStartTime.current = performance.now();
        setGenerationStats({ ttft: null, total: null });
        startStreaming();
      };

      const cleanup = window.electronAPI.onMessageSent(handleMessageSent);
      return cleanup; // Cleanup listener on unmount or dependency change
    }
  }, [selectedChatId, startStreaming]);

  // Listen for streaming chunks (real-time text updates)
  useEffect(() => {
    if (isElectron && window.electronAPI?.onOptimizationChunk) {
      const handleOptimizationChunk = (data: { chunk: string; accumulated: string }) => {
        handleChunk(data.chunk, data.accumulated);

        // Record TTFT (Time To First Token)
        setGenerationStats(prev => {
          if (prev.ttft === null && generationStartTime.current > 0) {
            const ttft = Math.round(performance.now() - generationStartTime.current);
            return { ...prev, ttft };
          }
          return prev;
        });
      };

      const cleanup = window.electronAPI.onOptimizationChunk(handleOptimizationChunk);
      return cleanup;
    }
  }, [handleChunk]);

  // Listen for assistant response (optimization result saved to DB)
  useEffect(() => {
    if (isElectron && window.electronAPI?.onMessageReceived) {
      const handleMessageReceived = (data: { chatId: string; message: any }) => {
        console.log('[Index] Assistant message received from DB (Final)');

        const assistantMessage: Message = {
          id: data.message.id,
          role: "assistant",
          content: data.message.content,
          timestamp: new Date(data.message.createdAt),
        };

        // Track this ID to hide it from main history while streaming
        setStreamedMessageId(assistantMessage.id);

        // Pass to hook for silent finalization
        handleFinalMessage(assistantMessage);

        // Record Total Time
        setGenerationStats(prev => {
          if (generationStartTime.current > 0) {
            const total = Math.round(performance.now() - generationStartTime.current);
            return { ...prev, total };
          }
          return prev;
        });
      };

      const cleanup = window.electronAPI.onMessageReceived(handleMessageReceived);
      return cleanup;
    }
  }, [handleFinalMessage]);

  // Listen for message send errors
  useEffect(() => {
    if (isElectron && window.electronAPI?.onMessageSendError) {
      const handleMessageSendError = (data: { error: string; details?: string }) => {
        console.error('[Index] Message send error:', data);
        setIsGenerating(false);
        setSendError(data.error);
        // Auto-clear after 6 s so it doesn't linger forever
        setTimeout(() => setSendError(null), 6000);
      };

      const cleanup = window.electronAPI.onMessageSendError(handleMessageSendError);
      return cleanup; // Cleanup listener on unmount
    }
  }, []);

  // Load messages from Supabase when a chat is selected
  useEffect(() => {
    if (selectedChatId && isElectron && window.electronAPI?.loadMessages) {
      console.log('[Index] Loading messages for chat:', selectedChatId);
      window.electronAPI.loadMessages(selectedChatId);
      setCurrentView("chat");
      setOfflineChatUnavailable(false); // reset while loading

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
      const handleMessagesLoaded = (data: { chatId: string; messages: any[]; error?: string }) => {
        console.log('[Index] Messages loaded from Supabase:', data.messages.length);

        if (data.chatId === selectedChatId) {
          const formattedMessages: Message[] = data.messages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.created_at),
            feedback: msg.metadata?.feedback,
          }));
          setMessages(formattedMessages);

          // If offline and no cached messages, show the offline empty-state instead of a toast
          if (!isOnline && formattedMessages.length === 0) {
            setOfflineChatUnavailable(true);
          } else {
            setOfflineChatUnavailable(false);
          }
        }
      };

      const cleanup = window.electronAPI.onMessagesLoaded(handleMessagesLoaded);
      return cleanup; // Cleanup listener on unmount or dependency change
    }
  }, [selectedChatId, isOnline]);

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

  // Chat management handlers
  const handleRenameChat = useCallback((chatId: string, newTitle: string) => {
    console.log('[Index] Renaming chat:', { chatId, newTitle });
    if (isElectron && window.electronAPI?.renameChat) {
      window.electronAPI.renameChat(chatId, newTitle);
    } else {
      // Fallback for web mode
      setRecentChats(prev =>
        prev.map(c => c.id === chatId ? { ...c, title: newTitle } : c)
      );
      if (selectedChatId === chatId) {
        setCurrentChatTitle(newTitle);
      }
      toast({
        title: "Chat renamed",
        description: `Chat renamed to "${newTitle}".`,
      });
    }
  }, [selectedChatId]);

  const handleDeleteChat = useCallback((chatId: string) => {
    console.log('[Index] Deleting chat:', chatId);
    if (isElectron && window.electronAPI?.deleteChat) {
      window.electronAPI.deleteChat(chatId);
    } else {
      // Fallback for web mode
      setRecentChats(prev => prev.filter(c => c.id !== chatId));
      if (selectedChatId === chatId) {
        setSelectedChatId(null);
        setMessages([]);
        setCurrentChatTitle('');
      }
      toast({
        title: "Chat deleted",
        description: "Chat has been permanently removed.",
      });
    }
  }, [selectedChatId]);

  // Chat handlers
  const handleNewChat = () => {
    console.log('[Index] Starting new chat');
    // Clear current chat selection and messages
    setMessages([]);
    setSelectedChatId(null);
    setCurrentChatTitle('');
    setCurrentView("chat");
    setOfflineChatUnavailable(false);
  };

  const handleSendMessage = useCallback((content: string, mode: "fast" | "thinking" = "fast") => {
    console.log('[Index] Sending message:', {
      chatId: selectedChatId,
      contentLength: content.length,
      mode
    });

    // Clear any previous send error
    setSendError(null);

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
        content: content,
        mode
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

  // Edit a user message: replace it in local state and re-send from that point.
  // All messages after the edited one are removed (same as ChatGPT behaviour).
  // We slice + immediately insert a placeholder user message in ONE setState call
  // so the UI never sees an empty messages array (which would flash the welcome screen).
  const handleEditMessage = useCallback((messageId: string, newContent: string) => {
    const placeholderId = `edit-placeholder-${Date.now()}`;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx === -1) return prev;
      return [
        ...prev.slice(0, idx),
        { id: placeholderId, role: "user" as const, content: newContent, timestamp: new Date() },
      ];
    });
    handleSendMessage(newContent, "fast");
  }, [handleSendMessage]);

  // Retry a user message: remove everything after it and re-send the same content.
  const handleRetryMessage = useCallback((messageId: string) => {
    // We need the content synchronously before modifying messages
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx === -1) return prev;
      const content = prev[idx].content;
      // Schedule the IPC call after this render — content is captured in closure
      setTimeout(() => handleSendMessage(content, "fast"), 0);
      return [
        ...prev.slice(0, idx),
        { id: `retry-placeholder-${Date.now()}`, role: "user" as const, content, timestamp: new Date() },
      ];
    });
  }, [handleSendMessage]);

  const handleSavePromptClick = (id: string) => {
    let message = displayMessages.find((m) => m.id === id);
    if (!message && streamingMessage?.id === id) {
      message = streamingMessage;
    }

    if (message) {
      setPromptToSave(message);
      setSaveModalOpen(true);
    }
  };

  const handleFeedback = (messageId: string, rating: "positive" | "negative") => {
    console.log('[Index] Feedback received:', { messageId, rating });

    // Send it to Supabase via Electron IPC
    if (isElectron && window.electronAPI?.saveFeedback) {
      window.electronAPI.saveFeedback(messageId, rating);
    }
    
    // Update local state so UI updates immediately
    setMessages((prev) => 
        prev.map((m) => m.id === messageId ? { ...m, feedback: { rating } } : m)
    );

    toast({
      title: "Thank you!",
      description: "Your feedback helps us improve.",
    });
  };

  const handleSavePrompt = async (collectionId: string, title: string, newCollectionName?: string) => {
    if (!promptToSave) return;

    try {
      let targetCollectionId = collectionId;

      // Create new collection in Supabase if needed
      if (collectionId === "new" && newCollectionName && isElectron && window.electronAPI?.promptLibrary) {
        const newCollection = await window.electronAPI.promptLibrary.createCollection(newCollectionName, "folder");
        targetCollectionId = newCollection.id;

        // Update local state
        setCollections((prev) => [...prev, {
          id: newCollection.id,
          name: newCollection.name,
          icon: newCollection.icon || "folder",
        }]);
      }

      // Save prompt to Supabase
      if (isElectron && window.electronAPI?.promptLibrary) {
        const savedPrompt = await window.electronAPI.promptLibrary.savePrompt(
          targetCollectionId,
          title,
          promptToSave.content,
          { source_chat: recentChats.find((c) => c.id === selectedChatId)?.title }
        );

        // Update local state
        setSavedPrompts((prev) => [{
          id: savedPrompt.id,
          title: savedPrompt.title,
          content: savedPrompt.content,
          collectionId: savedPrompt.collection_id,
          sourceChat: savedPrompt.metadata?.source_chat,
          createdAt: new Date(savedPrompt.created_at),
        }, ...prev]);
        setSavedPromptIds((prev) => [...prev, promptToSave.id]);

        toast({
          title: "Saved!",
          description: "Prompt saved to your library.",
        });
      }

      setSaveModalOpen(false);
      setPromptToSave(null);
    } catch (error: any) {
      console.error('[Index] Error saving prompt:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save prompt",
        variant: "destructive",
      });
    }
  };

  // Library handlers
  const handleCreateCollection = async (name: string) => {
    try {
      if (isElectron && window.electronAPI?.promptLibrary?.createCollection) {
        const created = await window.electronAPI.promptLibrary.createCollection(name, "folder");
        setCollections((prev) => [...prev, {
          id: created.id,
          name: created.name,
          icon: created.icon || "folder",
        }]);
      } else {
        setCollections((prev) => [...prev, { id: `col-${Date.now()}`, name, icon: "folder" }]);
      }
      toast({
        title: "Collection created",
        description: `"${name}" has been created.`,
      });
    } catch (error: any) {
      console.error('[Index] Error creating collection:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create collection",
        variant: "destructive",
      });
    }
  };

  const handleRenameCollection = async (id: string, name: string) => {
    try {
      if (isElectron && window.electronAPI?.promptLibrary?.renameCollection) {
        await window.electronAPI.promptLibrary.renameCollection(id, name);
      }
      setCollections((prev) =>
        prev.map((c) => (c.id === id ? { ...c, name } : c))
      );
      toast({
        title: "Collection renamed",
        description: `Collection renamed to "${name}".`,
      });
    } catch (error: any) {
      console.error('[Index] Error renaming collection:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to rename collection",
        variant: "destructive",
      });
    }
  };

  const handleDeleteCollection = async (id: string) => {
    try {
      if (isElectron && window.electronAPI?.promptLibrary?.deleteCollection) {
        await window.electronAPI.promptLibrary.deleteCollection(id);
      }
      setCollections((prev) => prev.filter((c) => c.id !== id));
      setSavedPrompts((prev) =>
        prev.filter((p) => p.collectionId !== id)
      );
      toast({
        title: "Collection deleted",
        description: "Collection and its prompts have been removed.",
      });
    } catch (error: any) {
      console.error('[Index] Error deleting collection:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete collection",
        variant: "destructive",
      });
    }
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
          <SettingsView />
        );
      case "chat":
      default:
        return (
          <ChatView
            messages={displayMessages}
            streamingMessage={streamingMessage}
            generationStats={generationStats}
            onSendMessage={handleSendMessage}
            onCopyPrompt={handleCopyPrompt}
            onSavePrompt={handleSavePromptClick}
            onFeedback={handleFeedback}
            onEditMessage={handleEditMessage}
            onRetryMessage={handleRetryMessage}
            savedPromptIds={savedPromptIds}
            isGenerating={isGenerating}
            isOnline={isOnline}
            offlineChatUnavailable={offlineChatUnavailable}
            sendError={sendError}
            onStopGeneration={handleStopGeneration}
            onRetryLoad={() => {
              if (selectedChatId && isElectron && window.electronAPI?.loadMessages) {
                setOfflineChatUnavailable(false);
                window.electronAPI.loadMessages(selectedChatId);
              }
            }}
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
            recentChats={recentChats}
            onSelectChat={setSelectedChatId}
            selectedChatId={selectedChatId}
            onNewChat={handleNewChat}
            onRenameChat={handleRenameChat}
            onDeleteChat={handleDeleteChat}
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

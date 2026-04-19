import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import * as Sentry from "@sentry/react";
import { LoginPage } from "@/components/auth/LoginPage";
import { AppLayout } from "@/components/layout/AppLayout";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatView } from "@/components/chat/ChatView";
import { SavePromptModal } from "@/components/chat/SavePromptModal";
import { PromptLibrary, Collection } from "@/components/library/PromptLibrary";
import { SavedPrompt } from "@/components/library/PromptCard";
import { SharedLibraryView } from "@/components/library/SharedLibraryView";
import { HistoryView, HistoryItem } from "@/components/history/HistoryView";
import { SettingsView } from "@/components/settings/SettingsView";
import { ProjectsView } from "@/components/projects/ProjectsView";
import { Message } from "@/components/chat/MessageBubble";
import type { ClarifyQuestion } from "@/components/chat/ClarificationCard";
import { PromptPreviewModal } from "@/components/library/PromptPreviewModal";
import { toast } from "@/hooks/use-toast";
import { useInitializeSettings } from "@/hooks/useInitializeSettings";
import { useSmoothStreaming } from "@/hooks/useSmoothStreaming";
import { useMessageTree } from "@/hooks/useMessageTree";
import { useChatUIState } from "@/hooks/useChatUIState";
import type { VersionInfo } from "@/hooks/useMessageTree";
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
  const { user, signOut } = useAuth();

  // Initialize settings after authentication, scoped to user
  useInitializeSettings(user?.profile?.id);

  // Navigation state
  const [currentView, setCurrentView] = useState<"chat" | "library" | "settings" | "history" | "shared-library" | "projects">("chat");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  // Ref always holds the latest selectedChatId — used in long-lived IPC listeners
  // to avoid stale closures when the user switches chats.
  const selectedChatIdRef = useRef<string | null>(null);
  useEffect(() => { selectedChatIdRef.current = selectedChatId; }, [selectedChatId]);
  const [recentChats, setRecentChats] = useState<any[]>([]);

  // Per-chat UI state (input, mode, skill, files)
  const {
    input,
    setInput,
    mode,
    selectedSkill,
    setSelectedSkill,
    attachedFiles,
    setAttachedFiles,
    deleteChatState,
  } = useChatUIState(selectedChatId);

  // Shared library token (set when opening a share link)
  const [sharedLibraryToken, setSharedLibraryToken] = useState<string | null>(null);

  // Chat sessions for history
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages; // always-current ref for use outside render
  const [isGenerating, setIsGenerating] = useState(false);
  const isGeneratingRef = useRef(false);
  isGeneratingRef.current = isGenerating;
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

  // Clarification state
  const [clarificationData, setClarificationData] = useState<any>(null);
  const clarificationDataRef = useRef<any>(null);
  clarificationDataRef.current = clarificationData;
  const pendingClarificationChatId = useRef<string | null>(null);
  // Keyed by **assistant** message ID so each version keeps its own choices
  const [clarificationAnswersMap, setClarificationAnswersMap] = useState<Record<string, { questions: ClarifyQuestion[]; answers: Record<string, string>; mode: 'single' | 'tasks' }>>({});
  // Holds choices temporarily until the assistant message ID is known.
  // _pendingKey is the temp key used in the map so the card stays visible during streaming.
  const pendingClarificationChoices = useRef<{ questions: ClarifyQuestion[]; answers: Record<string, string>; mode: 'single' | 'tasks'; _pendingKey?: string } | null>(null);
  const clarificationAnswersMapRef = useRef(clarificationAnswersMap);
  clarificationAnswersMapRef.current = clarificationAnswersMap;

  // Message version tree (edit/retry creates branches instead of slicing)
  const messageTree = useMessageTree();
  // Ref: when an edit/retry is in flight, holds the placeholder ID so
  // onMessageSent can reliably replace it.  Cleared after replacement.
  const pendingPlaceholderId = useRef<string | null>(null);
  // Ref: true while an edit/retry + response cycle is in progress.
  // Prevents onMessagesLoaded from flattening the tree mid-edit.
  const editInProgressRef = useRef(false);
  // Ref: prevents double sends between handleSubmit → IPC and onMessageSent.
  const sendingRef = useRef(false);
  // Ref: placeholder ID for an in-flight regeneration (assistant-only version).
  const pendingRegenPlaceholderId = useRef<string | null>(null);

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
    originalCreatorName: c.original_creator_name || undefined,
  }));

  const mapPrompts = (raw: any[], _collectionList?: Collection[]) => raw.map((p: any) => {
    return {
      id: p.id,
      title: p.title,
      content: p.content,
      collectionId: p.collection_id,
      sourceChat: p.metadata?.source_chat,
      createdAt: new Date(p.created_at),
      // Attribution is prompt-level. Only prompts copied from a shared library
      // carry this metadata; new prompts in the same collection stay untagged.
      originalCreatorName: p.metadata?.shared_origin_creator_name || undefined,
    };
  });

  // Load prompt library from Supabase on mount
  useEffect(() => {
    if (isElectron && window.electronAPI?.promptLibrary) {
      // Load collections first, then prompts so we can link originalCreatorName
      window.electronAPI.promptLibrary.getCollections()
        .then((rawCollections) => {
          console.log('[Index] Loaded collections from Supabase:', rawCollections.length);
          const mappedCollections = mapCollections(rawCollections);
          setCollections(mappedCollections);
          // Load prompts, passing mapped collections for creator enrichment
          return window.electronAPI.promptLibrary.getAll().then((rawPrompts) => {
            console.log('[Index] Loaded prompts from Supabase:', rawPrompts.length);
            setSavedPrompts(mapPrompts(rawPrompts, mappedCollections));
          });
        })
        .catch((err) => { console.error('[Index] Error loading library:', err); Sentry.captureException(err, { tags: { component: 'index-page' } }); });
    }
  }, [isElectron]);

  // Listen for real-time prompt library updates from main process
  // (fired when overlay saves a prompt or collection)
  useEffect(() => {
    if (isElectron && window.electronAPI?.onPromptLibraryLoaded) {
      window.electronAPI.onPromptLibraryLoaded((data: any) => {
        console.log('[Index] prompt-library:loaded event — refreshing library');
        if (data?.collections) {
          const mappedCollections = mapCollections(data.collections);
          setCollections(mappedCollections);
          if (data?.prompts) {
            setSavedPrompts(mapPrompts(data.prompts, mappedCollections));
          }
        } else if (data?.prompts) {
          setSavedPrompts((prev) => mapPrompts(data.prompts, collections));
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
          title: "Couldn't rename chat",
          description: data.error || "Something went wrong. Please try again.",
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
          messageTree.init([]);
          setCurrentChatTitle('');
        }
        toast({
          title: "Chat deleted",
          description: "It's been permanently removed.",
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
          title: "Couldn't delete chat",
          description: data.error || "Something went wrong. Please try again.",
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
    // ── Regeneration path: replace the assistant placeholder ──
    const regenPlaceholder = pendingRegenPlaceholderId.current;
    if (regenPlaceholder) {
      pendingRegenPlaceholderId.current = null;
      messageTree.replaceId(regenPlaceholder, finalMessage.id);
      setMessages((prev) => {
        // The placeholder was never in the messages array, so just add
        if (prev.some(m => m.id === finalMessage.id)) return prev;
        return [...prev, finalMessage];
      });
    } else if (!messageTree.has(finalMessage.id)) {
      // ── Normal path: add assistant as child of last active node ──
      const activePath = messageTree.getActivePath();
      const parentId = activePath.length > 0 ? activePath[activePath.length - 1] : messageTree.ROOT;
      messageTree.addChild(parentId, finalMessage.id);
      setMessages((prev) => {
        if (prev.some(m => m.id === finalMessage.id)) return prev;
        return [...prev, finalMessage];
      });
    }

    // Associate pending clarification choices with this assistant message
    const pendingChoices = pendingClarificationChoices.current;
    if (pendingChoices) {
      pendingClarificationChoices.current = null;
      const { _pendingKey, ...choices } = pendingChoices;
      setClarificationAnswersMap(prev => {
        const next = { ...prev, [finalMessage.id]: choices };
        if (_pendingKey && next[_pendingKey]) delete next[_pendingKey];
        return next;
      });
    }

    setStreamedMessageId(null);
    setIsGenerating(false);
    editInProgressRef.current = false;
    sendingRef.current = false;
  }, [messageTree.getActivePath, messageTree.addChild, messageTree.has, messageTree.ROOT, messageTree.replaceId]);

  const { streamingMessage, startStreaming, resumeStreaming, handleChunk, handleFinalMessage, stopStreaming, resetStreaming } = useSmoothStreaming({
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

  /**
   * Detach the UI from an in-flight generation WITHOUT stopping the backend.
   * The backend keeps streaming → saves messages to DB as usual.
   * When the user later navigates back to that chat, loadMessages will
   * pull the completed conversation from the DB.
   */
  const detachFromActiveGeneration = useCallback(() => {
    if (!isGeneratingRef.current) return;
    console.log('[Index] Detaching from active generation (chat switch — backend continues)');
    resetStreaming();
    setIsGenerating(false);
    setStreamedMessageId(null);
    editInProgressRef.current = false;
    sendingRef.current = false;
    pendingPlaceholderId.current = null;
    pendingRegenPlaceholderId.current = null;
  }, [resetStreaming]);

  // Build display messages from the tree's active path.
  // Only messages on the currently-active branch are shown.
  const displayMessages = useMemo(() => {
    const activePath = messageTree.getActivePath();
    const messageMap = new Map(messages.map(m => [m.id, m]));

    let display = activePath
      .map(id => messageMap.get(id))
      .filter((m): m is Message => !!m);

    // Hide the message currently being streamed (it's rendered separately)
    if (streamedMessageId) {
      display = display.filter(m => m.id !== streamedMessageId);
    }

    console.log('[VersionTree] RENDERING IDS:', activePath, '| total in array:', messages.length);

    return display;
  }, [messages, streamedMessageId, messageTree.version]);

  // Listen for message send confirmation (user message saved to DB)
  useEffect(() => {
    if (isElectron && window.electronAPI?.onMessageSent) {
      const handleMessageSent = (data: { chatId: string; chat: any; userMessage: any }) => {
        console.log('[Index] Message sent to Supabase:', data);

        // Ignore responses for a chat the user has already navigated away from.
        // For *new* chats selectedChatIdRef is null — accept those.
        const currentId = selectedChatIdRef.current;
        if (currentId !== null && currentId !== data.chatId) {
          console.log('[Index] Ignoring onMessageSent for non-current chat', data.chatId);
          return;
        }

        // Update selected chat ID if this was a new chat
        if (!currentId) {
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
          attachedFiles: data.userMessage.attachedFiles?.length > 0 ? data.userMessage.attachedFiles : undefined,
          selectedSkill: data.userMessage.selectedSkill || undefined,
          groupId: data.userMessage.groupId || undefined,
          versionIndex: data.userMessage.versionIndex ?? undefined,
        };

        // Determine if we're replacing a placeholder or adding a new message
        const placeholderId = pendingPlaceholderId.current;

        if (placeholderId) {
          // Replace placeholder ID in the version tree, then update the messages array
          pendingPlaceholderId.current = null;
          messageTree.replaceId(placeholderId, userMessage.id);
          setMessages((prev) => {
            const idx = prev.findIndex(m => m.id === placeholderId);
            if (idx !== -1) {
              const next = [...prev];
              next[idx] = userMessage;
              return next;
            }
            // Placeholder somehow missing — append but DON'T add to tree again
            return [...prev, userMessage];
          });
        } else {
          // Normal new message — add to tree as child of last active node
          const activePath = messageTree.getActivePath();
          const parentId = activePath.length > 0 ? activePath[activePath.length - 1] : messageTree.ROOT;
          messageTree.addChild(parentId, userMessage.id);
          setMessages((prev) => [...prev, userMessage]);
        }

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
      const handleOptimizationChunk = (data: { chatId: string | null; chunk: string; accumulated: string; source?: 'chat' | 'space' }) => {
        if (data.source === 'space') return;
        if (data.chatId && data.chatId !== selectedChatIdRef.current) return;

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
        // Ignore responses for a chat the user has already navigated away from.
        if (selectedChatIdRef.current !== null && data.chatId !== selectedChatIdRef.current) {
          console.log('[Index] Ignoring onMessageReceived for non-current chat', data.chatId);
          return;
        }

        console.log('[Index] Assistant message received from DB (Final)');

        const assistantMessage: Message = {
          id: data.message.id,
          role: "assistant",
          content: data.message.content,
          timestamp: new Date(data.message.createdAt),
          groupId: data.message.groupId || undefined,
          versionIndex: data.message.versionIndex ?? undefined,
        };

        if (isGeneratingRef.current) {
          // Normal path: streaming is active, animate the final message
          setStreamedMessageId(assistantMessage.id);
          handleFinalMessage(assistantMessage);

          // Record Total Time
          setGenerationStats(prev => {
            if (generationStartTime.current > 0) {
              const total = Math.round(performance.now() - generationStartTime.current);
              return { ...prev, total };
            }
            return prev;
          });
        } else {
          // Generation completed but UI wasn't streaming (e.g., user returned
          // from another chat and the generation finished in the gap before
          // getGenerationStatus could resume it). Directly commit the message
          // so it doesn't get silently dropped.
          console.log('[Index] Directly committing assistant message (streaming was not active)');
          handleStreamingComplete(assistantMessage);
        }
      };

      const cleanup = window.electronAPI.onMessageReceived(handleMessageReceived);
      return cleanup;
    }
  }, [handleFinalMessage, handleStreamingComplete]);

  // Listen for message send errors
  useEffect(() => {
    if (isElectron && window.electronAPI?.onMessageSendError) {
      const handleMessageSendError = (data: { error: string; details?: string }) => {
        console.error('[Index] Message send error:', data);
        setIsGenerating(false);
        editInProgressRef.current = false;
        pendingPlaceholderId.current = null;
        pendingRegenPlaceholderId.current = null;
        sendingRef.current = false;
        setSendError(data.error);
        // Auto-clear after 6 s so it doesn't linger forever
        setTimeout(() => setSendError(null), 6000);
      };

      const cleanup = window.electronAPI.onMessageSendError(handleMessageSendError);
      return cleanup; // Cleanup listener on unmount
    }
  }, []);

  // Listen for clarification-required from the backend
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onClarificationRequired) return;
    const cleanup = window.electronAPI.onClarificationRequired((data: any) => {
      if (data.chatId !== selectedChatIdRef.current) return;
      console.log('[Index] Clarification required for chat:', data.chatId);
      pendingClarificationChatId.current = data.chatId;
      setClarificationData(data);
      setIsGenerating(false);
    });
    return cleanup;
  }, []);

  // Listen for partial file upload failures (image uploads that failed after all retries)
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onUploadPartialFailure) return;
    const cleanup = window.electronAPI.onUploadPartialFailure((data) => {
      const names = data.failedFiles.join(', ');
      setSendError(`Some files failed to upload: ${names}. Check your connection and try again.`);
      setTimeout(() => setSendError(null), 7000);
    });
    return cleanup;
  }, []);

  // Listen for offline-queued send confirmation
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onSendMessageQueued) return;
    const cleanup = window.electronAPI.onSendMessageQueued((data) => {
      console.log('[Index] Message queued for offline send:', data.chatId);
      setSendError(data.message);
      setTimeout(() => setSendError(null), 8000);
    });
    return cleanup;
  }, []);

  // Listen for offline-queued messages being synced when back online
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onOfflineMessageSynced) return;
    const cleanup = window.electronAPI.onOfflineMessageSynced((data) => {
      console.log('[Index] Offline message synced for chat:', data.chatId);
      // If the user is viewing the chat that just got synced, append both messages
      if (selectedChatIdRef.current === data.chatId) {
        const um = data.userMessage;
        const am = data.assistantMessage;
        if (!messageTree.has(um.id)) {
          messageTree.addChild(null, { id: um.id, role: um.role, content: um.content, createdAt: um.createdAt, groupId: um.groupId, versionIndex: um.versionIndex ?? 0 });
        }
        if (!messageTree.has(am.id)) {
          messageTree.addChild(um.id, { id: am.id, role: am.role, content: am.content, createdAt: am.createdAt, groupId: am.groupId, versionIndex: am.versionIndex ?? 0 });
        }
      }
    });
    return cleanup;
  }, [messageTree]);

  // Load messages from Supabase when a chat is selected
  // IMPORTANT: deps must NOT include recentChats — the backend sends
  // 'chats-loaded' after every message, which would reload messages
  // mid-stream and flatten the version tree.
  const recentChatsRef = useRef(recentChats);
  recentChatsRef.current = recentChats;

  useEffect(() => {
    if (selectedChatId && isElectron && window.electronAPI?.loadMessages) {
      console.log('[Index] Loading messages for chat:', selectedChatId);
      window.electronAPI.loadMessages(selectedChatId);
      setCurrentView("chat");
      setOfflineChatUnavailable(false); // reset while loading

      // Find chat title from the ref (avoids recentChats in deps)
      const chat = recentChatsRef.current.find((c) => c.id === selectedChatId);
      if (chat) {
        setCurrentChatTitle(chat.title);
      }

      // Check if this chat has an active generation in the main process.
      // If so, resume streaming so the user sees the partial output and
      // the typewriter animation continues from where it left off.
      if (window.electronAPI.getGenerationStatus) {
        const resumeChatId = selectedChatId;
        window.electronAPI.getGenerationStatus(resumeChatId).then(status => {
          if (status.isActive && selectedChatIdRef.current === resumeChatId) {
            console.log('[Index] Resuming active generation for chat:', resumeChatId);
            setIsGenerating(true);
            generationStartTime.current = performance.now();
            resumeStreaming(status.accumulated);
          }
        });
      }
    }
  }, [selectedChatId]); // ← only selectedChatId — NOT recentChats

  // Separate effect: keep the header title in sync when a chat is renamed
  // (e.g. smart-title generation) WITHOUT reloading messages.
  useEffect(() => {
    if (selectedChatId) {
      const chat = recentChats.find((c) => c.id === selectedChatId);
      if (chat) {
        setCurrentChatTitle(chat.title);
      }
    }
  }, [recentChats, selectedChatId]);

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
            // Restore file metadata from DB (no base64 — just name/mimeType/sizeBytes for pills)
            attachedFiles: msg.metadata?.attachedFiles?.length > 0 ? msg.metadata.attachedFiles : undefined,
            selectedSkill: msg.metadata?.selectedSkill || undefined,
            groupId: msg.metadata?.groupId || undefined,
            versionIndex: msg.metadata?.versionIndex ?? undefined,
            // Restore error state so failed LLM responses render as error bubbles
            // instead of empty assistant messages after a reload.
            isError: msg.metadata?.isError ?? undefined,
            errorMessage: msg.metadata?.errorMessage ?? undefined,
          }));

          // Preserve base64 data from in-memory messages so file previews
          // keep working after a DB reload replaces them.
          setMessages(prev => {
            const base64Map = new Map<string, any[]>();
            for (const m of prev) {
              if (m.attachedFiles?.some((f: any) => f.base64)) {
                base64Map.set(m.id, m.attachedFiles!);
              }
            }
            if (base64Map.size === 0) return formattedMessages;
            return formattedMessages.map(m => {
              const rich = base64Map.get(m.id);
              if (rich) return { ...m, attachedFiles: rich };
              return m;
            });
          });

          // If offline and no cached messages, show the offline empty-state instead of a toast
          if (!isOnline && formattedMessages.length === 0) {
            setOfflineChatUnavailable(true);
          } else {
            setOfflineChatUnavailable(false);
          }

          // (Re-)initialise the version tree as a linear chain —
          // but ONLY if we're not in the middle of an edit/retry cycle
          // or an active send, otherwise we'd flatten the branches
          // and cause duplicates. Note: isGeneratingRef is intentionally
          // NOT checked here — when resuming a generation after switching
          // back to this chat, the tree MUST be re-initialized from the
          // loaded messages so displayMessages renders correctly.
          // sendingRef already guards the fresh-send-in-same-chat case.
          if (!editInProgressRef.current && !sendingRef.current) {
            messageTree.init(formattedMessages);
          }

          // Reconstruct clarification choices from assistant message metadata
          const restoredChoices: Record<string, { questions: ClarifyQuestion[]; answers: Record<string, string>; mode: 'single' | 'tasks' }> = {};
          for (const msg of data.messages) {
            if (msg.role === 'assistant' && msg.metadata?.clarificationChoices) {
              restoredChoices[msg.id] = msg.metadata.clarificationChoices;
            }
          }
          setClarificationAnswersMap(restoredChoices);
        }
      };

      const cleanup = window.electronAPI.onMessagesLoaded(handleMessagesLoaded);
      return cleanup; // Cleanup listener on unmount or dependency change
    }
  }, [selectedChatId, isOnline]);

  // ── Real-time overlay append ──────────────────────────────────────────────
  // When the overlay optimizes with a chat context, the backend saves the new
  // user + assistant messages into that chat and immediately fires
  // 'overlay:messages-appended' so we can append them without a full reload.
  //
  // Registered ONCE (empty deps) — reads selectedChatIdRef.current so it
  // always has the latest chat without stale-closure issues when the user
  // starts a new overlay session with a different chat context attached.
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onOverlayMessagesAppended) return;

    const handleOverlayAppend = (data: { chatId: string; messages: any[] }) => {
      // Use the ref so this handler is never stale, regardless of when it fires
      if (data.chatId !== selectedChatIdRef.current) return;

      console.log('[Index] overlay:messages-appended for current chat, appending', data.messages.length, 'msgs');

      const newMessages: Message[] = data.messages.map((msg: any) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        timestamp: new Date(msg.created_at),
        feedback: msg.metadata?.feedback,
        groupId: msg.groupId || msg.metadata?.groupId || undefined,
        versionIndex: msg.versionIndex ?? msg.metadata?.versionIndex ?? undefined,
      }));

      setMessages(prev => {
        // Deduplicate: skip any message whose id already exists
        const existingIds = new Set(prev.map(m => m.id));
        const toAdd = newMessages.filter(m => !existingIds.has(m.id));
        if (toAdd.length === 0) return prev;

        // Add each new message to the version tree.
        // If the message has a groupId that matches an existing message,
        // add it as a sibling (version branch); otherwise add linearly.
        for (const msg of toAdd) {
          if (messageTree.has(msg.id)) continue;

          if (msg.groupId) {
            // Look for an existing message with the same groupId → add as sibling
            const sibling = [...prev, ...toAdd].find(
              m => m.id !== msg.id && m.groupId === msg.groupId && messageTree.has(m.id),
            );
            if (sibling) {
              messageTree.addBranch(sibling.id, msg.id);
              continue;
            }
          }

          // Default: linear chain extension
          const activePath = messageTree.getActivePath();
          const parentId = activePath.length > 0 ? activePath[activePath.length - 1] : messageTree.ROOT;
          messageTree.addChild(parentId, msg.id);
        }

        return [...prev, ...toAdd];
      });
    };

    const cleanup = window.electronAPI.onOverlayMessagesAppended(handleOverlayAppend);
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — handler reads selectedChatIdRef, not selectedChatId

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
        description: `Renamed to "${newTitle}".`,
      });
    }
  }, [selectedChatId]);

  const handleDeleteChat = useCallback((chatId: string) => {
    console.log('[Index] Deleting chat:', chatId);
    deleteChatState(chatId);
    if (isElectron && window.electronAPI?.deleteChat) {
      window.electronAPI.deleteChat(chatId);
    } else {
      // Fallback for web mode — IPC `onChatDeleted` listener owns the toast
      // in Electron mode, so we don't fire one here to avoid double toasts.
      setRecentChats(prev => prev.filter(c => c.id !== chatId));
      if (selectedChatId === chatId) {
        setSelectedChatId(null);
        setMessages([]);
        messageTree.init([]);
        setCurrentChatTitle('');
      }
    }
  }, [selectedChatId, deleteChatState]);

  // ── Chat selection (abort any in-flight stream first) ────────
  const handleSelectChat = useCallback((chatId: string) => {
    if (chatId === selectedChatIdRef.current) return;
    Sentry.addBreadcrumb({ category: 'app.action', message: 'Chat selected', data: { chatId } });
    detachFromActiveGeneration();
    setClarificationAnswersMap({});
    setSelectedChatId(chatId);
  }, [detachFromActiveGeneration]);

  // Chat handlers
  const handleNewChat = () => {
    Sentry.addBreadcrumb({ category: 'app.action', message: 'New chat started' });
    detachFromActiveGeneration();
    // Clear current chat selection and messages
    setMessages([]);
    messageTree.init([]);
    setSelectedChatId(null);
    setCurrentChatTitle('');
    setCurrentView("chat");
    setOfflineChatUnavailable(false);
  };

  const handleSubmitClarification = useCallback((answers: Record<string, string>, wantsSections: boolean) => {
    Sentry.addBreadcrumb({ category: 'app.clarification', message: 'Clarification submitted', data: { answerCount: Object.keys(answers).length, wantsSections } });
    const currentClarification = clarificationDataRef.current;
    const lastUserMsg = [...messagesRef.current].reverse().find(m => m.role === 'user');
    const questions: ClarifyQuestion[] = (currentClarification?.questions || []).map((q: any) => ({
      id: q.id,
      question: q.question,
      type: q.type,
      options: q.options || [],
      optional: q.optional ?? false,
    }));
    const choicesPayload = { questions, answers, mode: (wantsSections ? 'tasks' : 'single') as 'single' | 'tasks' };

    // Store in map immediately with a temp key so the card is visible during streaming
    const pendingKey = lastUserMsg ? `_pending_${lastUserMsg.id}` : undefined;
    if (pendingKey) {
      setClarificationAnswersMap(prev => ({ ...prev, [pendingKey]: choicesPayload }));
    }
    pendingClarificationChoices.current = { ...choicesPayload, _pendingKey: pendingKey };

    setClarificationData(null);
    setIsGenerating(true);
    startStreaming();
    if (pendingClarificationChatId.current) {
      window.electronAPI?.submitClarification?.({
        chatId: pendingClarificationChatId.current,
        answers,
        wantsSections,
        clarificationChoices: choicesPayload,
      });
    }
  }, [startStreaming]);

  const handleSendMessage = useCallback((
    content: string, 
    mode: "fast" | "thinking" = "thinking",
    attachedFiles?: any[],
    selectedSkill?: string | null,
    versionMeta?: { groupId: string; versionIndex: number }
  ) => {
    if (sendingRef.current) {
      return;
    }
    Sentry.addBreadcrumb({ category: 'app.action', message: 'Message sent', data: { mode, hasFiles: !!(attachedFiles?.length), skill: selectedSkill || 'auto' } });
    sendingRef.current = true;

    const groupId = versionMeta?.groupId || crypto.randomUUID();
    const versionIndex = versionMeta?.versionIndex ?? 0;

    console.log('[Index] Sending message:', {
      chatId: selectedChatId,
      contentLength: content.length,
      mode,
      filesCount: attachedFiles?.length || 0,
      skill: selectedSkill || 'auto',
      groupId,
      versionIndex,
    });

    // Clear any previous send error or clarification
    setSendError(null);
    setClarificationData(null);

    // Use new unified send-message API that handles everything
    if (isElectron && window.electronAPI?.sendMessage) {
      window.electronAPI.sendMessage({
        chatId: selectedChatId,
        content: content,
        mode,
        attachedFiles,
        forcedSkill: selectedSkill,
        groupId,
        versionIndex,
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
    toast({ title: "Prompt copied" });
  };

  // Edit a user message: create a new branch in the version tree instead of
  // destroying old messages. The previous version + its responses remain
  // accessible via the ← / → version navigator.
  const handleEditMessage = useCallback((messageId: string, newContent: string) => {
    Sentry.addBreadcrumb({ category: 'app.action', message: 'Message edited', data: { messageId } });
    const placeholderId = `edit-placeholder-${Date.now()}`;

    // Mark edit in progress so tree isn't flattened by a reload
    editInProgressRef.current = true;
    pendingPlaceholderId.current = placeholderId;

    // Compute version metadata — reuse the original message's groupId
    const originalMsg = messagesRef.current.find(m => m.id === messageId);
    const groupId = originalMsg?.groupId || messageId; // legacy fallback
    const existingCount = messagesRef.current.filter(m => m.groupId === groupId).length;
    const versionIndex = existingCount > 0 ? existingCount : 1;

    // Create a sibling branch in the tree (makes the new branch active)
    messageTree.addBranch(messageId, placeholderId);

    // Append placeholder to messages array (old messages stay untouched)
    setMessages((prev) => [
      ...prev,
      { id: placeholderId, role: "user" as const, content: newContent, timestamp: new Date(), groupId, versionIndex },
    ]);

    handleSendMessage(newContent, mode, undefined, undefined, { groupId, versionIndex });
  }, [handleSendMessage, mode, messageTree.addBranch]);

  // Regenerate an assistant response: creates a new assistant version
  // under the SAME user message (no new user version created).
  const handleRegenerateMessage = useCallback((assistantMessageId: string) => {
    if (sendingRef.current) return;
    Sentry.addBreadcrumb({ category: 'app.action', message: 'Regenerate requested', data: { assistantMessageId } });

    // Walk the active path to find the user message before this assistant
    const activePath = messageTree.getActivePath();
    const aIdx = activePath.indexOf(assistantMessageId);
    if (aIdx < 1) return;
    const userMsgId = activePath[aIdx - 1];
    const userMsg = messagesRef.current.find(m => m.id === userMsgId);
    if (!userMsg || userMsg.role !== 'user') return;

    const originalAssistant = messagesRef.current.find(m => m.id === assistantMessageId);

    // Compute version metadata — reuse the assistant's groupId
    const groupId = originalAssistant?.groupId || assistantMessageId;
    const existingCount = messagesRef.current.filter(m => m.groupId === groupId).length;
    const versionIndex = existingCount > 0 ? existingCount : 1;

    const placeholderId = `regen-placeholder-${Date.now()}`;

    sendingRef.current = true;
    editInProgressRef.current = true;
    pendingRegenPlaceholderId.current = placeholderId;

    // Add as sibling of the current assistant (both children of the user message)
    messageTree.addBranch(assistantMessageId, placeholderId);

    // DON'T add the placeholder to the messages array — it has no content yet.
    // The streaming bubble renders the animation instead. When streaming
    // completes, handleStreamingComplete will replaceId + add the real message.

    // Send regeneration request (assistant-only, no new user message)
    if (isElectron && window.electronAPI?.regenerateResponse) {
      window.electronAPI.regenerateResponse({
        chatId: selectedChatId!,
        content: userMsg.content,
        mode,
        groupId,
        versionIndex,
        attachedFiles: userMsg.attachedFiles as any,
        forcedSkill: userMsg.selectedSkill || null,
        previousContent: originalAssistant?.content || undefined,
      });
    }

    setIsGenerating(true);
    generationStartTime.current = performance.now();
    setGenerationStats({ ttft: null, total: null });
    startStreaming();
  }, [selectedChatId, mode, startStreaming, messageTree]);

  // Re-optimize with changed clarification answers: finds the assistant
  // message after the given user message and regenerates it with new answers.
  const handleReoptimize = useCallback((userMessageId: string, newAnswers: Record<string, string>, wantsSections: boolean) => {
    if (sendingRef.current || !selectedChatId) return;

    const activePath = messageTree.getActivePath();
    const uIdx = activePath.indexOf(userMessageId);
    if (uIdx < 0 || uIdx >= activePath.length - 1) return;

    const assistantMsgId = activePath[uIdx + 1];
    const assistantMsg = messagesRef.current.find(m => m.id === assistantMsgId);
    if (!assistantMsg || assistantMsg.role !== 'assistant') return;

    const userMsg = messagesRef.current.find(m => m.id === userMessageId);
    if (!userMsg) return;

    // Build the choices payload — stored in ref until the new assistant ID arrives
    const prevInfo = clarificationAnswersMapRef.current[assistantMsgId];
    const choicesPayload = {
      questions: prevInfo?.questions || [],
      answers: newAnswers,
      mode: (wantsSections ? 'tasks' : 'single') as 'single' | 'tasks',
    };
    // Also store immediately with a temp key so the summary stays visible during streaming
    const pendingKey = `_pending_${userMessageId}`;
    setClarificationAnswersMap(prev => ({ ...prev, [pendingKey]: choicesPayload }));
    pendingClarificationChoices.current = { ...choicesPayload, _pendingKey: pendingKey };

    // Format answers the same way the backend expects
    const formattedAnswers = Object.entries(newAnswers)
      .filter(([, v]) => v && v.trim())
      .map(([key, val]) => `- ${key}: ${val}`)
      .join('\n');

    const groupId = assistantMsg.groupId || assistantMsgId;
    const existingCount = messagesRef.current.filter(m => m.groupId === groupId).length;
    const versionIndex = existingCount > 0 ? existingCount : 1;

    const placeholderId = `reopt-placeholder-${Date.now()}`;

    sendingRef.current = true;
    editInProgressRef.current = true;
    pendingRegenPlaceholderId.current = placeholderId;

    messageTree.addBranch(assistantMsgId, placeholderId);

    if (isElectron && window.electronAPI?.regenerateResponse) {
      window.electronAPI.regenerateResponse({
        chatId: selectedChatId,
        content: userMsg.content,
        mode,
        groupId,
        versionIndex,
        attachedFiles: userMsg.attachedFiles as any,
        forcedSkill: userMsg.selectedSkill || null,
        previousContent: assistantMsg.content || undefined,
        clarificationAnswers: formattedAnswers || undefined,
        wantsSections,
        clarificationChoices: choicesPayload,
      });
    }

    setIsGenerating(true);
    generationStartTime.current = performance.now();
    setGenerationStats({ ttft: null, total: null });
    startStreaming();
  }, [selectedChatId, mode, startStreaming, messageTree]);

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

    toast({ title: "Thanks for the feedback" });
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
          originalCreatorName: savedPrompt.metadata?.shared_origin_creator_name || undefined,
        }, ...prev]);
        setSavedPromptIds((prev) => [...prev, promptToSave.id]);

        toast({
          title: "Prompt saved",
          description: "Find it in your library.",
        });
      }

      setSaveModalOpen(false);
      setPromptToSave(null);
    } catch (error: any) {
      console.error('[Index] Error saving prompt:', error);
      toast({
        title: "Couldn't save prompt",
        description: error.message || "Something went wrong. Please try again.",
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
        description: `"${name}" is ready.`,
      });
    } catch (error: any) {
      console.error('[Index] Error creating collection:', error);
      toast({
        title: "Couldn't create collection",
        description: error.message || "Something went wrong. Please try again.",
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
        description: `Renamed to "${name}".`,
      });
    } catch (error: any) {
      console.error('[Index] Error renaming collection:', error);
      toast({
        title: "Couldn't rename collection",
        description: error.message || "Something went wrong. Please try again.",
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
        description: "It and its prompts have been removed.",
      });
    } catch (error: any) {
      console.error('[Index] Error deleting collection:', error);
      toast({
        title: "Couldn't delete collection",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCopyLibraryPrompt = (id: string) => {
    const prompt = savedPrompts.find((p) => p.id === id);
    if (prompt) {
      navigator.clipboard.writeText(prompt.content);
      toast({ title: "Prompt copied" });
    }
  };

  const handleEditPrompt = async (promptId: string, title: string, collectionId: string) => {
    try {
      if (isElectron && window.electronAPI?.promptLibrary?.updatePrompt) {
        await window.electronAPI.promptLibrary.updatePrompt(promptId, { title, collection_id: collectionId });
      }
      setSavedPrompts((prev) =>
        prev.map((p) =>
          p.id === promptId
            ? { ...p, title, collectionId }
            : p
        )
      );
      toast({ title: "Prompt updated" });
    } catch (error: any) {
      console.error('[Index] Error updating prompt:', error);
      toast({
        title: "Couldn't update prompt",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
      throw error; // re-throw so the modal stays open on failure
    }
  };

  const handleDeletePrompt = async (id: string) => {
    try {
      if (isElectron && window.electronAPI?.promptLibrary?.deletePrompt) {
        await window.electronAPI.promptLibrary.deletePrompt(id);
      }
      setSavedPrompts((prev) => prev.filter((p) => p.id !== id));
      toast({ title: "Prompt deleted" });
    } catch (error: any) {
      console.error('[Index] Error deleting prompt:', error);
      toast({
        title: "Couldn't delete prompt",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    }
  };

  // History handlers
  const handleSelectHistoryItem = (id: string) => {
    const session = chatSessions.find((s) => s.id === id);
    if (session) {
      detachFromActiveGeneration();
      // Restore the conversation
      setMessages(session.messages);
      messageTree.init(session.messages);
      setSelectedChatId(session.id);
      setCurrentView("chat");
      toast({
        title: "Chat restored",
        description: `Loaded "${session.title}".`,
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

  // ── Shared Library handlers ────────────────────────────────────────────────

  /**
   * Open the shared-library view for a given share token.
   * Called from the /share/:token route or a deep-link handler.
   */
  const handleOpenSharedLibrary = useCallback((token: string) => {
    setSharedLibraryToken(token);
    setCurrentView("shared-library");
  }, []);

  /**
   * Called when the user successfully saves a shared library.
   * Reloads the user's library and redirects to the library view.
   */
  const handleSharedLibrarySaved = useCallback(async (newCollectionId: string) => {
    // Reload the full library so the new collection appears with attribution
    if (isElectron && window.electronAPI?.promptLibrary) {
      try {
        const rawCollections = await window.electronAPI.promptLibrary.getCollections();
        const mappedCollections = mapCollections(rawCollections);
        setCollections(mappedCollections);
        const rawPrompts = await window.electronAPI.promptLibrary.getAll();
        setSavedPrompts(mapPrompts(rawPrompts, mappedCollections));
      } catch (err) {
        console.error('[Index] Error reloading library after save:', err);
      }
    }
    // Navigate to the library view
    setCurrentView("library");
    setSharedLibraryToken(null);
  }, [collections]);

  // ── Version navigation ──────────────────────────────────────
  const versionInfoMap = useMemo(() => {
    const map = new Map<string, VersionInfo>();
    for (const msg of displayMessages) {
      const info = messageTree.getVersionInfo(msg.id);
      if (info) map.set(msg.id, info);
    }
    return map;
  }, [displayMessages, messageTree.version]);

  const handleNavigateVersion = useCallback((parentId: string, direction: 'prev' | 'next') => {
    messageTree.navigate(parentId, direction);
  }, [messageTree.navigate]);

  // Render current view (auth is handled by AuthWrapper, so we're always authenticated here)
  const renderView = () => {
    switch (currentView) {
      case "shared-library":
        return (
          <SharedLibraryView
            token={sharedLibraryToken || ""}
            onBack={() => {
              setCurrentView("library");
              setSharedLibraryToken(null);
            }}
            onSaved={handleSharedLibrarySaved}
          />
        );
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
      case "projects":
        return (
          <ProjectsView onSendToChat={(prompt: string) => {
            handleNewChat();
            setCurrentView("chat");
            setInput(prompt);
          }} />
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
            onRegenerateMessage={handleRegenerateMessage}
            savedPromptIds={savedPromptIds}
            isGenerating={isGenerating}
            isOnline={isOnline}
            offlineChatUnavailable={offlineChatUnavailable}
            sendError={sendError}
            onStopGeneration={handleStopGeneration}
            avatarUrl={user?.profile?.avatar_url}
            versionInfoMap={versionInfoMap}
            onNavigateVersion={handleNavigateVersion}
            onRetryLoad={() => {
              if (selectedChatId && isElectron && window.electronAPI?.loadMessages) {
                setOfflineChatUnavailable(false);
                window.electronAPI.loadMessages(selectedChatId);
              }
            }}
            // Per-chat UI state
            input={input}
            setInput={setInput}
            mode={mode}
            attachedFiles={attachedFiles}
            setAttachedFiles={setAttachedFiles}
            selectedSkill={selectedSkill}
            setSelectedSkill={setSelectedSkill}
            clarificationData={clarificationData}
            onSubmitClarification={handleSubmitClarification}
            clarificationAnswersMap={clarificationAnswersMap}
            onReoptimize={handleReoptimize}
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
            onSelectChat={handleSelectChat}
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

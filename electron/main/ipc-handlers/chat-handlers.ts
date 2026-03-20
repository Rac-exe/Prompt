import { ipcMain } from 'electron';
import { ChatService } from '../database/services/chat-service';
import { OptimizationService } from '../database/services/optimization-service';
import { AppWindowManager } from '../windows/app-window-manager';
import { PythonClient } from '../api/python-client';
import { authState } from '../utils/auth-state';
import { SettingsService } from '../database/services/settings-service';
import { UserService } from '../database/services/user-service';
import { MemoryService } from '../database/services/memory-service';
import { MemoryAnalyzer } from '../database/services/memory-analyzer';
import { localCache } from '../database/local-cache';
import { networkMonitor } from '../ipc-handlers/network-monitor-singleton';

// ── File attachment types ─────────────────────────────────────────────────────
export interface AttachedFile {
  name: string;
  mimeType: string;
  base64: string;
  sizeBytes: number;
}

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];

const MAX_FILE_SIZE = 10_000_000; // 10 MB
const MAX_FILES_PER_MESSAGE = 5;
const MAX_TOTAL_SIZE = 25_000_000; // 25 MB total

/**
 * Validate attached files before forwarding to Python.
 * Returns error message if validation fails, null if valid.
 */
function validateAttachedFiles(files: AttachedFile[]): string | null {
  if (files.length > MAX_FILES_PER_MESSAGE) {
    return `Maximum ${MAX_FILES_PER_MESSAGE} files allowed per message`;
  }

  let totalSize = 0;
  for (const file of files) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimeType)) {
      return `File type not allowed: ${file.mimeType}`;
    }

    if (file.sizeBytes > MAX_FILE_SIZE) {
      return `File "${file.name}" exceeds 10 MB limit`;
    }

    totalSize += file.sizeBytes;
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    return `Total upload size exceeds 25 MB limit`;
  }

  return null; // Valid
}

// Lazy load services
let chatService: ChatService | null = null;
let optimizationService: OptimizationService | null = null;
let userService: UserService | null = null;
let settingsService: SettingsService | null = null;
let memoryService: MemoryService | null = null;
let memoryAnalyzer: MemoryAnalyzer | null = null;

function getServices() {
    if (!chatService) chatService = new ChatService();
    if (!optimizationService) optimizationService = new OptimizationService();
    if (!userService) userService = new UserService();
    if (!settingsService) settingsService = new SettingsService();
    if (!memoryService) memoryService = new MemoryService();
    if (!memoryAnalyzer) memoryAnalyzer = new MemoryAnalyzer();
    return { chatService, optimizationService, userService, settingsService, memoryService, memoryAnalyzer };
}

// Module-level state for optimization context
let currentOptimization: {
    optimizationId: string;
    originalText: string;
    optimizedText: string;
} | null = null;

/**
 * Register chat & app window IPC handlers.
 *
 * NOTE: Overlay-related handlers (optimize, replace, dismiss) are now in
 * overlay-ipc-handlers.ts. This file only handles app window interactions.
 */
export function registerChatHandlers(
    appWindowManager: AppWindowManager,
    pythonClient: PythonClient
) {
    const { chatService, optimizationService, userService, settingsService, memoryService: memory, memoryAnalyzer: analyzer } = getServices();

    // ============================================
    // APP WINDOW: Optimize prompt request
    // ============================================
    ipcMain.on('app:optimize-prompt', async (event, promptText: string, isRegenerate: boolean = false, chatId?: string, mode: string = 'fast') => {
        try {
            // Retrieve chat history for context-aware optimization
            let chatHistory: Array<{ role: string; content: string }> | null = null;
            if (authState.isAuthenticated && chatId) {
                try {
                    const messages = await chatService.getMessages(chatId);
                    chatHistory = messages.slice(-10).map(msg => ({
                        role: msg.role,
                        content: msg.content
                    }));
                } catch (historyError) {
                    console.error('[Chat] Failed to retrieve chat history:', historyError);
                }
            }

            let customInstructions = '';
            if (authState.isAuthenticated && userService && settingsService) {
                try {
                    const profile = await userService.getUserProfile();
                    if (profile) {
                        const settings = await settingsService.getUserSettings(profile.id);
                        customInstructions = settings?.prompt_instructions || '';
                    }
                } catch (settingsErr) {
                    console.warn('[Chat] Failed to fetch custom instructions:', settingsErr);
                }
            }
            // Append user memory context (non-blocking, silent failure)
            if (authState.isAuthenticated && memory) {
                try {
                    const memCtx = await memory.buildMemoryContext();
                    if (memCtx) customInstructions = customInstructions ? `${customInstructions}\n\n${memCtx}` : memCtx;
                } catch { /* non-critical */ }
            }

            // Use streaming optimization
            const optimizedText = await pythonClient.optimizeStream(
                promptText,
                isRegenerate,
                chatHistory,
                (chunk, accumulated) => {
                    if (appWindowManager) {
                        appWindowManager.send('optimization-chunk', { chunk, accumulated });
                    }
                },
                mode,
                customInstructions
            );

            // Save optimization to database
            if (authState.isAuthenticated) {
                try {
                    const optimization = await optimizationService.saveOptimization(
                        promptText,
                        optimizedText,
                        'app_window',
                        {
                            model: 'llama3.2',
                            source_context: { app: 'app_window' },
                        }
                    );

                    currentOptimization = {
                        optimizationId: optimization.id,
                        originalText: promptText,
                        optimizedText,
                    };
                } catch (dbError) {
                    console.error('[Chat] Failed to save optimization to DB:', dbError);
                }
            }

            // Send completion signal to app window
            if (appWindowManager) {
                appWindowManager.send('optimization-complete', {
                    original: promptText,
                    optimized: optimizedText,
                });
            }
        } catch (error) {
            console.error('[Chat] Optimization failed:', error);
            if (appWindowManager) {
                appWindowManager.send('optimization-complete', {
                    original: promptText,
                    optimized: 'Optimization failed. Please try again.',
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }
    });

    // ============================================
    // APP WINDOW: Save to chat
    // ============================================
    ipcMain.on('app:save-to-chat', async (event, originalText: string, optimizedText: string) => {
        try {
            const chat = await chatService.getOrCreateQuickOptimizationsChat();
            await chatService.addMessage(chat.id, originalText, 'user');
            await chatService.addMessage(
                chat.id,
                optimizedText,
                'assistant',
                currentOptimization?.optimizationId
            );

            if (appWindowManager) {
                appWindowManager.send('chat-saved', { chatId: chat.id });
            }
        } catch (error) {
            console.error('[Chat] Failed to save to chat:', error);
        }
    });

    // ============================================
    // APP WINDOW: Load chats
    // ============================================
    ipcMain.on('app:load-chats', async (event) => {
        try {
            const userId = authState.currentUserId;
            if (!networkMonitor.isOnline) {
                // Serve from cache when offline
                const cached = userId ? localCache.getChats(userId) : [];
                console.warn('[Chat] Offline — returning', cached.length, 'cached chats');
                if (appWindowManager) appWindowManager.send('chats-loaded', { chats: cached });
                return;
            }

            const chats = await chatService.getChats();

            // Update cache
            if (userId) localCache.setChats(userId, chats as any);

            if (appWindowManager) appWindowManager.send('chats-loaded', { chats });

            // ╠═══ Pre-fetch messages for top 5 recent chats (background) ════
            if (userId && chats.length > 0) {
                const top5 = chats.slice(0, 5);
                Promise.all(
                    top5.map(async (chat: any) => {
                        try {
                            const msgs = await chatService.getMessages(chat.id);
                            localCache.setMessages(userId, chat.id, msgs as any);
                        } catch (_) { /* best-effort */ }
                    })
                ).then(() => console.log('[Chat] Pre-cached messages for top 5 recent chats'));
            }
        } catch (error) {
            console.error('[Chat] Failed to load chats:', error);
            const userId = authState.currentUserId;
            const cached = userId ? localCache.getChats(userId) : [];
            if (appWindowManager) appWindowManager.send('chats-loaded', { chats: cached, error: String(error) });
        }
    });

    // ============================================
    // APP WINDOW: Create new chat
    // ============================================
    ipcMain.on('app:create-chat', async (event, title?: string) => {
        try {
            const chat = await chatService.createChat(title);
            if (appWindowManager) {
                appWindowManager.send('chat-created', { chat });
                const chats = await chatService.getChats();
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            console.error('[Chat] Failed to create chat:', error);
        }
    });

    // ============================================
    // APP WINDOW: Load messages for a chat
    // ============================================
    ipcMain.on('app:load-messages', async (event, chatId: string) => {
        const userId = authState.currentUserId;
        try {
            if (!networkMonitor.isOnline) {
                // Serve from cache when offline
                const cached = userId ? localCache.getMessages(userId, chatId) : [];
                console.warn('[Chat] Offline — returning', cached.length, 'cached messages for chat', chatId);
                if (appWindowManager) appWindowManager.send('messages-loaded', { chatId, messages: cached });
                return;
            }

            const messages = await chatService.getMessages(chatId);

            // Cache every chat the user opens while online
            if (userId) localCache.setMessages(userId, chatId, messages as any);

            if (appWindowManager) appWindowManager.send('messages-loaded', { chatId, messages });
        } catch (error) {
            console.error('[Chat] Failed to load messages:', error);
            // Fallback to cache on any error (e.g. "Not authenticated" when offline)
            const cached = userId ? localCache.getMessages(userId, chatId) : [];
            if (appWindowManager) {
                appWindowManager.send('messages-loaded', {
                    chatId,
                    messages: cached,
                    ...(cached.length === 0 && { error: String(error) })
                });
            }
        }
    });

    // ============================================
    // APP WINDOW: Rename chat
    // ============================================
    ipcMain.on('app:rename-chat', async (event, data: { chatId: string; title: string }) => {
        try {
            await chatService.updateChatTitle(data.chatId, data.title);
            if (appWindowManager) {
                appWindowManager.send('chat-renamed', { chatId: data.chatId, title: data.title });
                // Reload chats list to reflect the new name
                const chats = await chatService.getChats();
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            console.error('[Chat] Failed to rename chat:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (appWindowManager) {
                appWindowManager.send('chat-rename-error', { chatId: data.chatId, error: errorMessage });
            }
        }
    });

    // ============================================
    // APP WINDOW: Delete chat
    // ============================================
    ipcMain.on('app:delete-chat', async (event, chatId: string) => {
        try {
            await chatService.deleteChat(chatId);
            if (appWindowManager) {
                appWindowManager.send('chat-deleted', { chatId });
                const chats = await chatService.getChats();
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            console.error('[Chat] Failed to delete chat:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (appWindowManager) {
                appWindowManager.send('chat-delete-error', { chatId, error: errorMessage });
            }
        }
    });

    // ============================================
    // APP WINDOW: Send message (creates chat if needed, saves, optimizes)
    // ============================================
    ipcMain.on('app:send-message', async (event, data: { 
        chatId: string | null; 
        content: string; 
        mode?: string;
        attachedFiles?: AttachedFile[];
        forcedSkill?: string | null;
    }) => {
        try {
            // Validate attached files if present
            const attachedFiles = data.attachedFiles || [];
            if (attachedFiles.length > 0) {
                const validationError = validateAttachedFiles(attachedFiles);
                if (validationError) {
                    console.error('[Chat] File validation failed:', validationError);
                    if (appWindowManager) {
                        appWindowManager.send('send-message-error', { error: validationError });
                    }
                    return;
                }
                console.log(`[Chat] Validated ${attachedFiles.length} attached files`);
            }
            
            let chatId = data.chatId;
            let chat;

            // Create chat if it doesn't exist
            if (!chatId) {
                if (!authState.isAuthenticated) {
                    throw new Error('User must be authenticated to create chat');
                }
                // Create the chat immediately with a first-4-words placeholder title
                // so the user sees something in the sidebar right away.
                const placeholderTitle = data.content.trim().split(/\s+/).slice(0, 4).join(' ');
                chat = await chatService.createChat(placeholderTitle);
                chatId = chat.id;

                // Fire-and-forget: generate a smart title in the background.
                // Once the title is ready, update the DB and push to the renderer.
                (async () => {
                    try {
                        const smartTitle = await pythonClient.generateTitle(data.content);
                        if (smartTitle && smartTitle !== placeholderTitle) {
                            await chatService.updateChatTitle(chatId!, smartTitle);
                            // Push the rename to the sidebar immediately
                            if (appWindowManager) {
                                appWindowManager.send('chat-renamed', {
                                    chatId: chatId!,
                                    title: smartTitle,
                                });
                            }
                            console.log(`[Chat] Smart title generated: "${smartTitle}"`);
                        }
                    } catch (err) {
                        console.warn('[Chat] Smart title generation failed (non-critical):', err);
                    }
                })();
            } else {
                chat = await chatService.getChat(chatId);
            }

            // Save user message — store full file data (including base64) so PDF/image
            // preview works even after switching chats or restarting the app.
            const filesForDb = attachedFiles.map(f => ({ name: f.name, mimeType: f.mimeType, base64: f.base64, sizeBytes: f.sizeBytes }));
            const userMessage = await chatService.addMessage(chatId, data.content, 'user', undefined, {
                attachedFiles: filesForDb.length > 0 ? filesForDb : undefined,
                selectedSkill: data.forcedSkill || undefined,
            });

            // Send immediate confirmation — include full AttachedFile (with base64) for in-session thumbnail
            if (appWindowManager) {
                appWindowManager.send('message-sent', {
                    chatId,
                    chat,
                    userMessage: {
                        id: userMessage.id,
                        chatId: userMessage.chat_id,
                        role: userMessage.role,
                        content: userMessage.content,
                        createdAt: userMessage.created_at,
                        attachedFiles: data.attachedFiles || [],
                        selectedSkill: data.forcedSkill || null,
                    }
                });
            }

            let customInstructions = '';
            if (authState.isAuthenticated && userService && settingsService) {
                try {
                    const profile = await userService.getUserProfile();
                    if (profile) {
                        const settings = await settingsService.getUserSettings(profile.id);
                        customInstructions = settings?.prompt_instructions || '';
                    }
                } catch (settingsErr) {
                    console.warn('[Chat] Failed to fetch custom instructions:', settingsErr);
                }
            }
            // Append user memory context (non-blocking, silent failure)
            if (authState.isAuthenticated && memory) {
                try {
                    const memCtx = await memory.buildMemoryContext();
                    if (memCtx) customInstructions = customInstructions ? `${customInstructions}\n\n${memCtx}` : memCtx;
                } catch { /* non-critical */ }
            }

            // Fetch chat history for context
            let messagesContext: Array<{role: string, content: string}> = [];
            try {
                const history = await chatService.getMessages(chatId);
                // Get the last 10 messages, but EXCLUDE the one we just added (the new prompt)
                // because the python backend expects the new prompt separately
                const relevantHistory = history.filter(m => m.id !== userMessage.id).slice(-10);
                messagesContext = relevantHistory.map(m => ({
                    role: m.role,
                    content: m.content
                }));
            } catch (historyErr) {
                console.warn('[Chat] Failed to fetch chat history for context:', historyErr);
            }

            // Trigger streaming optimization
            const optimizedText = await pythonClient.optimizeStream(
                data.content,
                false,
                messagesContext.length > 0 ? messagesContext : null,
                (chunk, accumulated) => {
                    if (appWindowManager) {
                        appWindowManager.send('optimization-chunk', { chunk, accumulated });
                    }
                },
                data.mode || 'fast',
                customInstructions,
                attachedFiles,
                data.forcedSkill || null
            );

            // Save optimization record and trigger background memory analysis
            let optimizationId: string | undefined;
            if (authState.isAuthenticated) {
                try {
                    const optimization = await optimizationService.saveOptimization(
                        data.content,
                        optimizedText,
                        'app_window',
                        { model: 'llama3.2', source_context: { app: 'app_window', chat_id: chatId } }
                    );
                    optimizationId = optimization.id;
                    // Trigger background memory analysis (fire-and-forget, non-critical)
                    if (analyzer && authState.currentUserId) {
                        analyzer.onNewOptimization(authState.currentUserId).catch((e: unknown) =>
                            console.warn('[Memory] Analyzer error (non-critical):', e)
                        );
                    }
                } catch (dbError) {
                    console.error('[Chat] Failed to save optimization record:', dbError);
                }
            }

            // Save assistant message
            const assistantMessage = await chatService.addMessage(
                chatId,
                optimizedText,
                'assistant',
                optimizationId,
                { model: 'llama3.2', optimized: true }
            );

            // Send assistant message to renderer
            if (appWindowManager) {
                appWindowManager.send('message-received', {
                    chatId,
                    message: {
                        id: assistantMessage.id,
                        chatId: assistantMessage.chat_id,
                        role: assistantMessage.role,
                        content: assistantMessage.content,
                        createdAt: assistantMessage.created_at,
                    }
                });
            }

            // Reload chats list to update timestamps
            const chats = await chatService.getChats();
            if (appWindowManager) {
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            console.error('[Chat] Failed to send message:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (appWindowManager) {
                appWindowManager.send('message-send-error', {
                    error: errorMessage,
                    details: error instanceof Error ? error.stack : undefined
                });
            }
        }
    });

    // ============================================
    // APP WINDOW: Copy to clipboard
    // ============================================
    ipcMain.on('app:copy-to-clipboard', (event, text: string) => {
        const { clipboard } = require('electron');
        clipboard.writeText(text);
    });

    // ============================================
    // APP WINDOW: Save Feedback
    // ============================================
    ipcMain.on('app:save-feedback', async (event, data: { messageId: string; rating: 'positive' | 'negative' }) => {
        try {
            await chatService.saveFeedback(data.messageId, data.rating);
            if (appWindowManager) {
                appWindowManager.send('feedback-saved', { messageId: data.messageId, rating: data.rating });
            }
        } catch (error) {
            console.error('[Chat] Failed to save feedback:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (appWindowManager) {
                appWindowManager.send('feedback-error', { messageId: data.messageId, error: errorMessage });
            }
        }
    });

    // APP WINDOW: Stop generation mid-stream
    // ============================================
    ipcMain.on('app:stop-generation', () => {
        console.log('[Chat] Stop generation requested');
        pythonClient.abortLatestStream();
    });
}

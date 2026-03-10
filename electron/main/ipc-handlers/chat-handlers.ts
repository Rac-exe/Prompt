import { ipcMain } from 'electron';
import { ChatService } from '../database/services/chat-service';
import { OptimizationService } from '../database/services/optimization-service';
import { AppWindowManager } from '../windows/app-window-manager';
import { PythonClient } from '../api/python-client';
import { authState } from '../utils/auth-state';
import { SettingsService } from '../database/services/settings-service';
import { UserService } from '../database/services/user-service';

// Lazy load services
let chatService: ChatService | null = null;
let optimizationService: OptimizationService | null = null;
let userService: UserService | null = null;
let settingsService: SettingsService | null = null;

function getServices() {
    if (!chatService) chatService = new ChatService();
    if (!optimizationService) optimizationService = new OptimizationService();
    if (!userService) userService = new UserService();
    if (!settingsService) settingsService = new SettingsService();
    return { chatService, optimizationService, userService, settingsService };
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
    const { chatService, optimizationService, userService } = getServices();

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

            let customInstructions = "";
            if (authState.isAuthenticated && userService && settingsService) {
                try {
                    const profile = await userService.getUserProfile();
                    if (profile) {
                        const settings = await settingsService.getUserSettings(profile.id);
                        customInstructions = settings?.prompt_instructions || "";
                    }
                } catch (settingsErr) {
                    console.warn('[Chat] Failed to fetch custom instructions:', settingsErr);
                }
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
            const chats = await chatService.getChats();
            if (appWindowManager) {
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            console.error('[Chat] Failed to load chats:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (appWindowManager) {
                appWindowManager.send('chats-loaded', { chats: [], error: errorMessage });
            }
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
        try {
            const messages = await chatService.getMessages(chatId);
            if (appWindowManager) {
                appWindowManager.send('messages-loaded', { chatId, messages });
            }
        } catch (error) {
            console.error('[Chat] Failed to load messages:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (appWindowManager) {
                appWindowManager.send('messages-loaded', { chatId, messages: [], error: errorMessage });
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
    ipcMain.on('app:send-message', async (event, data: { chatId: string | null; content: string; mode?: string }) => {
        try {
            let chatId = data.chatId;
            let chat;

            // Create chat if it doesn't exist
            if (!chatId) {
                if (!authState.isAuthenticated) {
                    throw new Error('User must be authenticated to create chat');
                }
                // Limit title to first 4 words (like ChatGPT style)
                const words = data.content.trim().split(/\s+/).slice(0, 4);
                const title = words.join(' ');
                chat = await chatService.createChat(title);
                chatId = chat.id;
            } else {
                chat = await chatService.getChat(chatId);
            }

            // Save user message
            const userMessage = await chatService.addMessage(chatId, data.content, 'user');

            // Send immediate confirmation
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
                    }
                });
            }

            let customInstructions = "";
            if (authState.isAuthenticated && userService && settingsService) {
                try {
                    const profile = await userService.getUserProfile();
                    if (profile) {
                        const settings = await settingsService.getUserSettings(profile.id);
                        customInstructions = settings?.prompt_instructions || "";
                    }
                } catch (settingsErr) {
                    console.warn('[Chat] Failed to fetch custom instructions:', settingsErr);
                }
            }

            // Trigger streaming optimization
            const optimizedText = await pythonClient.optimizeStream(
                data.content,
                false,
                null,
                (chunk, accumulated) => {
                    if (appWindowManager) {
                        appWindowManager.send('optimization-chunk', { chunk, accumulated });
                    }
                },
                data.mode || 'fast',
                customInstructions
            );

            // Save optimization record
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
}

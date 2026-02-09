import { ipcMain } from 'electron';
import { ChatService } from '../database/services/chat-service';
import { OptimizationService } from '../database/services/optimization-service';
import { UserService } from '../database/services/user-service';
import { AppWindowManager } from '../windows/app-window-manager';
import { FloatingPanel } from '../overlay/floating-panel';
import { PythonClient } from '../api/python-client';
import { authState } from '../utils/auth-state';

// Lazy load services
let chatService: ChatService | null = null;
let optimizationService: OptimizationService | null = null;
let userService: UserService | null = null;

function getServices() {
    if (!chatService) chatService = new ChatService();
    if (!optimizationService) optimizationService = new OptimizationService();
    if (!userService) userService = new UserService();
    return { chatService, optimizationService, userService };
}

// Module-level state for optimization context
let currentOptimization: {
    optimizationId: string;
    originalText: string;
    optimizedText: string;
} | null = null;

export function registerChatHandlers(
    appWindowManager: AppWindowManager,
    pythonClient: PythonClient,
    floatingPanel: FloatingPanel
) {
    const { chatService, optimizationService, userService } = getServices();

    // ============================================
    // CHAT & OPTIMIZATION IPC HANDLERS
    // ============================================

    // Overlay: Prompt submission for optimization
    ipcMain.on('floating-panel:prompt-submit', async (event, data: string | { text: string; isRegenerate?: boolean; chatId?: string }) => {
        const promptText = typeof data === 'string' ? data : data.text;
        const skipCache = typeof data === 'string' ? false : !!data.isRegenerate;
        const chatId = typeof data === 'object' ? data.chatId : undefined;

        console.log('[Chat] Prompt submitted:', promptText.substring(0, 50), chatId ? `(chatId: ${chatId})` : '(no chat context)');

        const panelWindow = floatingPanel.getWindow();
        if (!panelWindow || panelWindow.isDestroyed()) {
            console.error('[Chat] Panel window not available');
            return;
        }

        try {
            // Get personalization prompt if user is authenticated
            let finalPrompt = promptText;
            if (authState.isAuthenticated) {
                const personalizationPrompt = await userService.getPersonalizationPrompt();
                if (personalizationPrompt) {
                    console.log('[Chat] Using personalization prompt');
                }
            }

            // Retrieve chat history for context-aware optimization
            let chatHistory: Array<{ role: string; content: string }> | null = null;
            if (authState.isAuthenticated && chatId) {
                try {
                    const messages = await chatService.getMessages(chatId);
                    // Get last 10 messages and format for Python service
                    chatHistory = messages.slice(-10).map(msg => ({
                        role: msg.role,
                        content: msg.content
                    }));
                    console.log(`[Chat] Retrieved ${chatHistory.length} messages for context`);
                } catch (historyError) {
                    console.error('[Chat] Failed to retrieve chat history (continuing without context):', historyError);
                }
            }

            // Use streaming optimization
            const optimizedText = await pythonClient.optimizeStream(
                finalPrompt,
                skipCache,
                chatHistory,
                (chunk, accumulated) => {
                    // Send each chunk to the overlay for progressive display
                    if (panelWindow && !panelWindow.isDestroyed()) {
                        panelWindow.webContents.send('optimization-chunk', {
                            chunk,
                            accumulated
                        });
                    }
                }
            );

            // Save optimization to database (source: overlay) - only if authenticated
            if (authState.isAuthenticated) {
                try {
                    const optimization = await optimizationService.saveOptimization(
                        promptText,
                        optimizedText,
                        'overlay',
                        {
                            model: 'llama3.2',
                            latency_ms: 0,
                            source_context: { app: 'overlay', chat_id: chatId },
                        }
                    );

                    currentOptimization = {
                        optimizationId: optimization.id,
                        originalText: promptText,
                        optimizedText,
                    };

                    // If we have a chatId, save the user message and assistant response
                    if (chatId) {
                        await chatService.addMessage(chatId, promptText, 'user', optimization.id);
                        await chatService.addMessage(chatId, optimizedText, 'assistant', optimization.id);
                        console.log('[Chat] Saved messages to chat history');
                    }
                } catch (dbError) {
                    console.error('[Chat] Failed to save optimization to DB (continuing anyway):', dbError);
                }
            } else {
                console.log('[Chat] ℹ️ User not authenticated, optimization not saved to DB');
            }

            // Send completion signal to overlay
            if (panelWindow && !panelWindow.isDestroyed()) {
                panelWindow.webContents.send('optimization-complete', {
                    original: promptText,
                    optimized: optimizedText,
                });
            }
        } catch (error) {
            console.error('[Chat] Optimization failed:', error);
            // Send error to overlay
            if (panelWindow && !panelWindow.isDestroyed()) {
                panelWindow.webContents.send('optimization-error', {
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
    });

    // Overlay: Prompt submission for chat
    ipcMain.on('floating-panel:prompt-submit-chat', async (event, data: string) => {
        console.log('[Chat] Prompt submitted for chat:', data.substring(0, 50));

        try {
            // Send result to app window to handle chat message
            if (appWindowManager) {
                appWindowManager.send('floating-panel:chat-message-submit', { content: data });
            }
            floatingPanel.hide();
        } catch (error) {
            console.error('[Chat] Chat prompt submission failed:', error);
        }
    });

    // Overlay: Replace button clicked (mark optimization as applied)
    ipcMain.on('floating-panel:replace-text', async (event, data: { optimizedText: string }) => {
        console.log('[Chat] Replace requested');

        if (currentOptimization) {
            await optimizationService.markAsApplied(currentOptimization.optimizationId);
        }

        // Copy to clipboard
        const { clipboard } = require('electron');
        clipboard.writeText(data.optimizedText);

        // Hide overlay
        floatingPanel.hide();
    });

    // Overlay: Dismiss
    ipcMain.on('floating-panel:dismiss', () => {
        console.log('[Chat] Overlay dismissed');
        floatingPanel.hide();
    });

    // App Window: Optimize prompt request
    ipcMain.on('app:optimize-prompt', async (event, promptText: string, isRegenerate: boolean = false, chatId?: string) => {
        console.log('[Chat] App window optimization request:', promptText.substring(0, 50), chatId ? `(chatId: ${chatId})` : '(no chat context)');

        try {
            // Get personalization prompt if user is authenticated
            let finalPrompt = promptText;
            if (authState.isAuthenticated) {
                const personalizationPrompt = await userService.getPersonalizationPrompt();
                if (personalizationPrompt) {
                    console.log('[Chat] Using personalization prompt for app window optimization');
                    // Note: Python service handles personalization logic if implemented
                }
            }

            // Retrieve chat history for context-aware optimization
            let chatHistory: Array<{ role: string; content: string }> | null = null;
            if (authState.isAuthenticated && chatId) {
                try {
                    const messages = await chatService.getMessages(chatId);
                    // Get last 10 messages and format for Python service
                    chatHistory = messages.slice(-10).map(msg => ({
                        role: msg.role,
                        content: msg.content
                    }));
                    console.log(`[Chat] Retrieved ${chatHistory.length} messages for context`);
                } catch (historyError) {
                    console.error('[Chat] Failed to retrieve chat history (continuing without context):', historyError);
                }
            }

            // Use streaming optimization
            const optimizedText = await pythonClient.optimizeStream(
                finalPrompt,
                isRegenerate,
                chatHistory,
                (chunk, accumulated) => {
                    // Send each chunk to the app window for progressive display
                    if (appWindowManager) {
                        appWindowManager.send('optimization-chunk', {
                            chunk,
                            accumulated
                        });
                    }
                }
            );

            // Save optimization to database (source: app_window) - only if authenticated
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
                    console.error('[Chat] Failed to save optimization to DB (continuing anyway):', dbError);
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

    // App Window: Save to chat
    ipcMain.on('app:save-to-chat', async (event, originalText: string, optimizedText: string) => {
        console.log('[Chat] Saving to chat...');

        try {
            // Get or create "Quick Optimizations" chat
            const chat = await chatService.getOrCreateQuickOptimizationsChat();

            // Add user message (original)
            await chatService.addMessage(chat.id, originalText, 'user');

            // Add assistant message (optimized)
            await chatService.addMessage(
                chat.id,
                optimizedText,
                'assistant',
                currentOptimization?.optimizationId
            );

            console.log('[Chat] Saved to chat successfully');
            if (appWindowManager) {
                appWindowManager.send('chat-saved', { chatId: chat.id });
            }
        } catch (error) {
            console.error('[Chat] Failed to save to chat:', error);
        }
    });

    // App Window: Load chats
    ipcMain.on('app:load-chats', async (event) => {
        try {
            console.log('[Chat] Loading chats...');
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

    // App Window: Create new chat
    ipcMain.on('app:create-chat', async (event, title?: string) => {
        try {
            console.log('[Chat] Creating new chat...');
            const chat = await chatService.createChat(title);
            if (appWindowManager) {
                appWindowManager.send('chat-created', { chat });
                // Reload chats list
                const chats = await chatService.getChats();
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            console.error('[Chat] Failed to create chat:', error);
        }
    });

    // App Window: Load messages for a chat
    ipcMain.on('app:load-messages', async (event, chatId: string) => {
        try {
            console.log('[Chat] Loading messages for chat:', chatId);
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

    // App Window: Send message (creates chat if needed, saves message, triggers optimization)
    ipcMain.on('app:send-message', async (event, data: { chatId: string | null; content: string }) => {
        try {
            console.log('[Chat] 📥 Received send-message request:', {
                chatId: data.chatId,
                contentLength: data.content.length
            });

            let chatId = data.chatId;
            let chat;

            // Create chat if it doesn't exist
            if (!chatId) {
                console.log('[Chat] 🆕 No chat ID provided, creating new chat');
                const title = data.content.slice(0, 50) + (data.content.length > 50 ? '...' : '');

                // Verify user is authenticated
                if (!authState.isAuthenticated) {
                    throw new Error('User must be authenticated to create chat');
                }

                chat = await chatService.createChat(title);
                chatId = chat.id;

                console.log('[Chat] ✅ Created new chat in Supabase:', {
                    chatId: chat.id,
                    title: chat.title,
                    user_id: chat.user_id
                });
            } else {
                console.log('[Chat] 📂 Using existing chat:', chatId);
                chat = await chatService.getChat(chatId);
            }

            // Save user message to database
            console.log('[Chat] 💾 Saving user message to Supabase...');
            const userMessage = await chatService.addMessage(chatId, data.content, 'user');
            console.log('[Chat] ✅ User message saved:', userMessage.id);

            // Send immediate confirmation with chat and user message
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

            // Trigger optimization with streaming
            console.log('[Chat] 🤖 Triggering streaming optimization...');
            const optimizedText = await pythonClient.optimizeStream(
                data.content,
                false,
                null,
                (chunk, accumulated) => {
                    // Send each chunk to the app window for progressive display
                    if (appWindowManager) {
                        // console.log(`[Chat] 📤 Sending chunk to app window (${accumulated.length} chars)`);
                        appWindowManager.send('optimization-chunk', {
                            chunk,
                            accumulated
                        });
                    }
                }
            );
            console.log('[Chat] ✅ Optimization complete');

            // Save optimization record to DB (for analytics)
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
                    console.log('[Chat] ✅ Optimization record saved:', optimizationId);
                } catch (dbError) {
                    console.error('[Chat] ⚠️ Failed to save optimization record (continuing):', dbError);
                }
            }

            // Save assistant message to database
            console.log('[Chat] 💾 Saving assistant message to Supabase...');
            const assistantMessage = await chatService.addMessage(
                chatId,
                optimizedText,
                'assistant',
                optimizationId,
                { model: 'llama3.2', optimized: true }
            );
            console.log('[Chat] ✅ Assistant message saved:', assistantMessage.id);

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

            console.log('[Chat] ✅ Message flow complete');
        } catch (error) {
            console.error('[Chat] ❌ Failed to send message:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (appWindowManager) {
                appWindowManager.send('message-send-error', {
                    error: errorMessage,
                    details: error instanceof Error ? error.stack : undefined
                });
            }
        }
    });

    // App Window: Copy to clipboard (Moved here for consolidation)
    ipcMain.on('app:copy-to-clipboard', (event, text: string) => {
        const { clipboard } = require('electron');
        clipboard.writeText(text);
    });
}

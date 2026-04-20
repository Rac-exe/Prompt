import { ipcMain } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { logger } from '@sentry/core';
import crypto from 'crypto';
import FileType from 'file-type';
import { ChatService } from '../database/services/chat-service';
import { OptimizationService } from '../database/services/optimization-service';
import { AppWindowManager } from '../windows/app-window-manager';
import { PythonClient, ModelsUsed, ClarifyResult } from '../api/python-client';
import { authState } from '../utils/auth-state';
import { SettingsService } from '../database/services/settings-service';
import { UserService } from '../database/services/user-service';
import { MemoryService } from '../database/services/memory-service';
import { MemoryAnalyzer } from '../database/services/memory-analyzer';
import { localCache } from '../database/local-cache';
import { networkMonitor } from '../ipc-handlers/network-monitor-singleton';
import { uploadAttachment } from './file-upload-service';
import { offlineQueue } from '../database/offline-queue';
import { RateLimitService } from '../database/services/rate-limit-service';
import { analyticsService } from '../analytics/analytics-service';
import { getActiveProjectId, getActiveProjectBranch } from './project-handlers';

// ── Model metadata helper ─────────────────────────────────────────────────────
function buildModelMeta(models?: ModelsUsed): Record<string, unknown> {
    return {
        model: models?.optimizer ?? 'unknown',
        ...(models?.summarizer && { summarizer_model: models.summarizer }),
        ...(models?.used_vision && { used_vision: true }),
    };
}

// ── File attachment types ─────────────────────────────────────────────────────
export interface AttachedFile {
  name: string;
  mimeType: string;
  base64: string;
  sizeBytes: number;
}

// ── Smart title helpers ───────────────────────────────────────────────────────

/** Patterns that indicate a message is too generic to drive a meaningful title. */
const WEAK_PATTERNS = [
  /^(help|assist)\s+(me\s+)?(with\s+)?(this|it|my|the)?\.?\s*$/i,
  /^(fix|improve|optimize|edit|review|check|update|rewrite|change|tune|tweak|adjust)\s+(this|it|my|the)?\s*[.!?]?\s*$/i,
  /^(can\s+you|please|could\s+you)\s+(help|fix|improve|optimize|review)/i,
  /^(make\s+(this|it)\s+better)/i,
  /^(do\s+(this|it|that))/i,
];

export function isWeakMessage(content: string): boolean {
  const trimmed = content.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 2) return true;
  return WEAK_PATTERNS.some(p => p.test(trimmed));
}

/**
 * Build the prompt string to send to /generate-title.
 * Returns null if the message is too generic — in that case use "New Chat".
 */
/**
 * Convert a raw Node.js / network error from the Python service into a
 * short, user-readable sentence.  Raw messages like
 * "connect ECONNREFUSED 127.0.0.1:8001" are meaningless to end-users.
 */
function humanizeLlmError(err: any): string {
  const raw: string = (err?.message ?? err?.code ?? String(err)).toLowerCase();

  if (raw.includes('econnrefused') || raw.includes('econnreset') || raw.includes('enotfound')) {
    return 'The AI service is not reachable. Please restart the application and try again.';
  }
  if (raw.includes('etimedout') || raw.includes('timeout')) {
    return 'The AI service timed out. It may be overloaded — please try again in a moment.';
  }
  if (raw.includes('socket hang up') || raw.includes('epipe')) {
    return 'The connection to the AI service was lost mid-response. Please try again.';
  }
  // Fallback — still better than a raw stack-trace fragment
  return 'The AI service encountered an error. Please try again.';
}

export function buildTitlePrompt(
  content: string,
  attachedFiles: Pick<AttachedFile, 'name' | 'mimeType'>[]
): string | null {
  const trimmed = content.trim();
  const hasFiles = attachedFiles.length > 0;
  const fileNames = attachedFiles.map(f => f.name).join(', ');

  // No text and no files → nothing to work with
  if (!trimmed && !hasFiles) return null;

  // Files only (empty message) → title from file names
  if (!trimmed && hasFiles) return fileNames;

  // Weak/generic text + files → use file names as the signal
  if (isWeakMessage(trimmed) && hasFiles) return fileNames;

  // Weak/generic text, no files → skip LLM, default to "New Chat"
  if (isWeakMessage(trimmed)) return null;

  // Meaningful text + files → combine both signals
  if (hasFiles) return `${trimmed.slice(0, 180)} (files: ${fileNames})`;

  // Meaningful text only → pass it directly, capped at 200 chars
  return trimmed.slice(0, 200);
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
 * Checks count, size (from actual buffer, not user-supplied metadata),
 * and MIME type against magic bytes — not the user-supplied mimeType field.
 * Returns an error string if validation fails, null if valid.
 */
async function validateAttachedFiles(files: AttachedFile[]): Promise<string | null> {
  if (files.length > MAX_FILES_PER_MESSAGE) {
    return `Maximum ${MAX_FILES_PER_MESSAGE} files allowed per message`;
  }

  let totalSize = 0;
  for (const file of files) {
    const buf = Buffer.from(file.base64, 'base64');

    // Use actual buffer byte count — not the renderer-supplied sizeBytes
    const actualSize = buf.length;
    if (actualSize > MAX_FILE_SIZE) {
      return `File "${file.name}" exceeds 10 MB limit`;
    }
    totalSize += actualSize;

    // Detect MIME from magic bytes — ignores whatever the renderer claims
    const detected = await FileType.fromBuffer(buf);
    const effectiveMime = detected?.mime ?? 'application/octet-stream';
    if (!ALLOWED_MIME_TYPES.includes(effectiveMime)) {
      return `File "${file.name}" is not an allowed type (detected: ${effectiveMime})`;
    }
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    return `Total upload size exceeds 25 MB limit`;
  }

  return null;
}

// Lazy load services
let chatService: ChatService | null = null;
let optimizationService: OptimizationService | null = null;
let userService: UserService | null = null;
let settingsService: SettingsService | null = null;
let memoryService: MemoryService | null = null;
let memoryAnalyzer: MemoryAnalyzer | null = null;
let rateLimitService: RateLimitService | null = null;

function getServices(pythonClient?: PythonClient, appWindowManager?: AppWindowManager) {
    if (!chatService) chatService = new ChatService();
    if (!optimizationService) optimizationService = new OptimizationService();
    if (!userService) userService = new UserService();
    if (!settingsService) settingsService = new SettingsService();
    if (!memoryService) memoryService = new MemoryService();
    if (!rateLimitService) rateLimitService = new RateLimitService();
    if (!memoryAnalyzer && pythonClient) {
        memoryAnalyzer = new MemoryAnalyzer(pythonClient, memoryService, settingsService, userService, appWindowManager);
    }
    return { chatService, optimizationService, userService, settingsService, memoryService, memoryAnalyzer, rateLimitService };
}

// Module-level state for optimization context
let currentOptimization: {
    optimizationId: string;
    originalText: string;
    optimizedText: string;
} | null = null;

// Track in-flight generations so the renderer can resume streaming after a chat switch.
const activeGenerations = new Map<string, { accumulated: string }>();

interface PendingOptimization {
    data: {
        chatId: string | null;
        content: string;
        mode?: string;
        attachedFiles?: AttachedFile[];
        forcedSkill?: string | null;
        groupId?: string;
        versionIndex?: number;
    };
    chatId: string;
    customInstructions: string;
    messagesContext: Array<{ role: string; content: string }>;
}

const pendingClarifications = new Map<string, PendingOptimization>();

function formatClarificationAnswers(answers: Record<string, string>): string {
    return Object.entries(answers)
        .filter(([, v]) => v && v.trim())
        .map(([key, val]) => `- ${key}: ${val}`)
        .join('\n');
}

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
    const { chatService, optimizationService, userService, settingsService, memoryService: memory, memoryAnalyzer: analyzer, rateLimitService } = getServices(pythonClient, appWindowManager);

    // ============================================
    // APP WINDOW: Optimize prompt request
    // ============================================
    ipcMain.on('app:optimize-prompt', async (event, promptText: string, isRegenerate: boolean = false, chatId?: string, mode: string = 'thinking', source: 'chat' | 'space' = 'chat') => {
        Sentry.addBreadcrumb({ category: 'chat', message: 'Optimize prompt (legacy)', level: 'info', data: { mode } });
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
            // Append user memory context (guarded by toggle, non-blocking, silent failure)
            if (authState.isAuthenticated && memory && analyzer) {
                try {
                    const memEnabled = await analyzer.isMemoryEnabled();
                    if (memEnabled) {
                        const memCtx = await memory.buildMemoryContext();
                        if (memCtx) customInstructions = customInstructions ? `${customInstructions}\n\n${memCtx}` : memCtx;
                    }
                } catch { /* non-critical */ }
            }

            // Use streaming optimization
            if (chatId) activeGenerations.set(chatId, { accumulated: '' });
            let optimizedText: string;
            let modelsUsed: ModelsUsed | undefined;
            try {
                const result = await pythonClient.optimizeStream(
                    promptText,
                    isRegenerate,
                    chatHistory,
                    (chunk, accumulated) => {
                        if (chatId) activeGenerations.set(chatId, { accumulated });
                        if (appWindowManager) {
                            appWindowManager.send('optimization-chunk', { chatId: chatId || null, chunk, accumulated, source });
                        }
                    },
                    mode,
                    customInstructions,
                    [],
                    null,
                    null,
                    null,
                    false,
                    // Space mode: the renderer (SpaceWorkspace) has already
                    // run retrieval against the *correct* space-scoped
                    // project_id(s) and embedded the resulting chunks into
                    // `promptText` via buildTailoredPrompt. Passing the
                    // global `getActiveProjectId()` here would trigger a
                    // SECOND retrieval inside the Python optimizer against
                    // whichever folder was last "active" globally — which
                    // is often a different space's folder, leaking its
                    // code into the prompt. Skip the server-side retrieval
                    // entirely in space mode.
                    source === 'space' ? null : getActiveProjectId(),
                    source === 'space' ? null : getActiveProjectBranch(),
                );
                optimizedText = result.text;
                modelsUsed = result.models;
            } finally {
                if (chatId) activeGenerations.delete(chatId);
            }

            // Save optimization to database
            if (authState.isAuthenticated) {
                try {
                    const optimization = await optimizationService.saveOptimization(
                        promptText,
                        optimizedText,
                        'app_window',
                        {
                            ...buildModelMeta(modelsUsed),
                            source_context: { app: 'app_window' },
                        }
                    );

                    currentOptimization = {
                        optimizationId: optimization.id,
                        originalText: promptText,
                        optimizedText,
                    };

                    // Trigger background memory analysis (fire-and-forget, non-critical)
                    if (analyzer && authState.currentUserId) {
                        analyzer.onNewOptimization(
                            authState.currentUserId,
                            promptText,
                            optimizedText,
                            null,
                        ).catch((e: unknown) =>
                            console.warn('[Chat] Memory analyzer error (non-critical):', e)
                        );
                    }
                } catch (dbError) {
                    console.error('[Chat] Failed to save optimization to DB:', dbError);
                }
            }

            // Send completion signal to app window
            if (appWindowManager) {
                appWindowManager.send('optimization-complete', {
                    original: promptText,
                    optimized: optimizedText,
                    source,
                });
            }

            analyticsService.logEvent('optimization', { source: 'app' });
        } catch (error) {
            Sentry.captureException(error);
            console.error('[Chat] Optimization failed:', error);
            if (appWindowManager) {
                appWindowManager.send('optimization-error', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    source,
                });
            }
        }
    });

    // ============================================
    // APP WINDOW: Save to chat
    // ============================================
    ipcMain.on('app:save-to-chat', async (event, originalText: string, optimizedText: string) => {
        Sentry.addBreadcrumb({ category: 'chat', message: 'Save to chat', level: 'info' });
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
            Sentry.captureException(error);
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
            Sentry.captureException(error);
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
        Sentry.addBreadcrumb({ category: 'chat', message: 'Create chat', level: 'info' });
        try {
            const chat = await chatService.createChat(title);
            if (appWindowManager) {
                appWindowManager.send('chat-created', { chat });
                const chats = await chatService.getChats();
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            Sentry.captureException(error);
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
            Sentry.captureException(error);
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
        Sentry.addBreadcrumb({ category: 'chat', message: 'Rename chat', level: 'info', data: { chatId: data.chatId } });
        try {
            await chatService.updateChatTitle(data.chatId, data.title);
            if (appWindowManager) {
                appWindowManager.send('chat-renamed', { chatId: data.chatId, title: data.title });
                // Reload chats list to reflect the new name
                const chats = await chatService.getChats();
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            Sentry.captureException(error);
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
        Sentry.addBreadcrumb({ category: 'chat', message: 'Delete chat', level: 'info', data: { chatId } });
        try {
            await chatService.deleteChat(chatId);
            if (appWindowManager) {
                appWindowManager.send('chat-deleted', { chatId });
                const chats = await chatService.getChats();
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            Sentry.captureException(error);
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
        groupId?: string;
        versionIndex?: number;
    }) => {
        Sentry.addBreadcrumb({ category: 'chat', message: 'Message sent', level: 'info', data: { mode: data.mode, skill: data.forcedSkill, chatId: data.chatId } });
        logger.info(logger.fmt`chat.message_sent chatId=${data.chatId ?? 'new'} mode=${data.mode ?? 'thinking'} skill=${data.forcedSkill ?? 'none'}`);
        await Sentry.startSpan({ name: 'optimize-prompt', op: 'ai.optimization', attributes: { mode: data.mode || 'thinking', skill: data.forcedSkill || 'none' } }, async () => {
        try {
            // ── Offline guard ─────────────────────────────────────────────────
            // File uploads require network access. Reject early with a clear error
            // so the user doesn't lose their message silently.
            if (!networkMonitor.isOnline) {
                const hasFiles = (data.attachedFiles?.length ?? 0) > 0;
                if (hasFiles) {
                    if (appWindowManager) {
                        appWindowManager.send('message-send-error', {
                            error: 'You are offline. File attachments cannot be sent without a network connection.',
                        });
                    }
                    return;
                }

                // Text-only to an EXISTING chat → queue for retry when back online.
                // The queue op.id doubles as the stable message UUID so duplicate
                // replays produce a DB conflict and are safely ignored.
                if (data.chatId) {
                    offlineQueue.enqueue('send-message', {
                        chatId: data.chatId,
                        content: data.content,
                        mode: data.mode,
                        forcedSkill: data.forcedSkill,
                        groupId: data.groupId,
                        versionIndex: data.versionIndex,
                    });
                    if (appWindowManager) {
                        appWindowManager.send('send-message-queued', {
                            chatId: data.chatId,
                            content: data.content,
                            message: "You're offline — your message has been queued and will be sent automatically when the connection is restored.",
                        });
                    }
                    return;
                }

                // New chat while offline — can't create chat without network.
                if (appWindowManager) {
                    appWindowManager.send('message-send-error', {
                        error: "You're offline. New chats can't be created without a network connection.",
                    });
                }
                return;
            }

            // ── Rate limit guard ──────────────────────────────────────────────
            if (authState.isAuthenticated && authState.currentUserId && rateLimitService) {
                try {
                    const rl = await rateLimitService.checkRateLimit(authState.currentUserId);
                    if (!rl.allowed) {
                        console.warn(`[Chat] Rate limit exceeded for user ${authState.currentUserId} (${rl.limit - rl.remaining}/${rl.limit})`);
                        if (appWindowManager) {
                            appWindowManager.send('message-send-error', {
                                error: `Daily message limit reached (${rl.limit}/${rl.limit}). Your limit resets at midnight UTC.`,
                            });
                        }
                        return;
                    }
                } catch (rlErr) {
                    console.warn('[Chat] Rate limit check failed (allowing message):', rlErr);
                    Sentry.captureMessage('Rate limit fail-open', 'warning');
                    logger.warn('chat.rate_limit_check_failed — allowing message through');
                }
            }

            // Validate attached files if present
            const attachedFiles = data.attachedFiles || [];
            if (attachedFiles.length > 0) {
                const validationError = await validateAttachedFiles(attachedFiles);
                if (validationError) {
                    console.error('[Chat] File validation failed:', validationError);
                    if (appWindowManager) {
                        appWindowManager.send('message-send-error', { error: validationError });
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
            // Create the chat immediately with a placeholder title so the user
            // sees something in the sidebar right away.
            const titlePrompt = buildTitlePrompt(data.content, attachedFiles);
            const placeholderTitle = titlePrompt
              ? data.content.trim().split(/\s+/).slice(0, 4).join(' ') || titlePrompt.split(/\s+/).slice(0, 4).join(' ')
              : 'New Chat';
            chat = await chatService.createChat(placeholderTitle);
            chatId = chat.id;

            // Fire-and-forget: generate a smart title in the background.
            // Only triggered when there is meaningful user input to work from.
            if (titlePrompt) {
                (async () => {
                    try {
                        const smartTitle = await pythonClient.generateTitle(titlePrompt);
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
            }
            } else {
                chat = await chatService.getChat(chatId);
            }

            // ── Insert message + notify renderer FIRST, upload in background ──
            // Strategy: DB INSERT with file metadata (no URLs) → fire message-sent
            // → start uploads in parallel with optimization. This ensures the
            // renderer shows the user message instantly and DB reloads find it.
            const userGroupId = data.groupId || crypto.randomUUID();
            const userVersionIndex = data.versionIndex ?? 0;
            const preGeneratedMessageId = crypto.randomUUID();

            // Insert message to DB with file metadata only (name/type/size).
            // Cloudinary URLs are backfilled asynchronously after upload completes.
            const filesMetadataOnly = attachedFiles.map(f => ({
                name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes,
            }));
            const userMessage = await chatService.addMessage(
                chatId, data.content, 'user', undefined,
                {
                    attachedFiles: filesMetadataOnly.length > 0 ? filesMetadataOnly : undefined,
                    selectedSkill: data.forcedSkill || undefined,
                    groupId: userGroupId,
                    versionIndex: userVersionIndex,
                },
                preGeneratedMessageId,
            );

            // Notify renderer immediately — base64 is included for in-session thumbnails.
            // The DB already has the record, so any selectedChatId-triggered reload will
            // find it (avoiding the blank-screen flash).
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
                        attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
                        selectedSkill: data.forcedSkill || null,
                        groupId: userGroupId,
                        versionIndex: userVersionIndex,
                    }
                });
            }

            // Fire-and-forget: upload files to Cloudinary/Supabase Storage in background.
            // Results are written back to the DB for future sessions; current session
            // displays thumbnails from in-memory base64.
            if (attachedFiles.length > 0 && authState.currentUserId) {
                const userId = authState.currentUserId;
                (async () => {
                    try {
                        const results = await Promise.allSettled(
                            attachedFiles.map(f =>
                                uploadAttachment(f, userId, chatId, preGeneratedMessageId, pythonClient)
                            )
                        );
                        const filesForDb = results.map((r, i) => {
                            if (r.status === 'fulfilled') return r.value;
                            const uploadErr = (r as PromiseRejectedResult).reason;
                            console.error(`[Chat] Upload failed for "${attachedFiles[i].name}":`, uploadErr?.message);
                            Sentry.captureException(uploadErr, { tags: { component: 'file-upload', context: 'chat' }, extra: { fileName: attachedFiles[i].name, mimeType: attachedFiles[i].mimeType } });
                            return { name: attachedFiles[i].name, mimeType: attachedFiles[i].mimeType, sizeBytes: attachedFiles[i].sizeBytes, uploadFailed: true };
                        });
                        await chatService.updateMessageAttachments(userMessage.id, filesForDb);
                        const succeeded = filesForDb.filter((f: any) => !f.uploadFailed).length;
                        const chatFailedNames = filesForDb.filter((f: any) => f.uploadFailed).map((f: any) => f.name);
                        Sentry.addBreadcrumb({ category: 'chat', message: 'Background uploads complete', level: 'info', data: { messageId: userMessage.id, succeeded, failed: chatFailedNames.length } });
                        if (chatFailedNames.length > 0 && appWindowManager) {
                            appWindowManager.send('upload-partial-failure', { failedFiles: chatFailedNames });
                        }
                    } catch (bgErr) {
                        console.error('[Chat] Background upload failed:', bgErr);
                        Sentry.captureException(bgErr, { tags: { component: 'file-upload-bg' }, extra: { messageId: userMessage.id, chatId } });
                    }
                })();
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
            // Append user memory context (guarded by toggle, non-blocking, silent failure)
            if (authState.isAuthenticated && memory && analyzer) {
                try {
                    const memEnabled = await analyzer.isMemoryEnabled();
                    if (memEnabled) {
                        const memCtx = await memory.buildMemoryContext();
                        if (memCtx) customInstructions = customInstructions ? `${customInstructions}\n\n${memCtx}` : memCtx;
                    }
                } catch { /* non-critical */ }
            }

            // Fetch chat history for context
            let messagesContext: Array<{role: string, content: string}> = [];
            try {
                const history = await chatService.getMessages(chatId);
                const relevantHistory = history.filter(m => m.id !== userMessage.id).slice(-10);
                messagesContext = relevantHistory.map(m => ({
                    role: m.role,
                    content: m.content
                }));
            } catch (historyErr) {
                console.warn('[Chat] Failed to fetch chat history for context:', historyErr);
            }

            // ── Clarification check ──────────────────────────────────────────
            // Only on first send (no clarificationAnswers yet) and only for
            // new requests (not refinements detected by weak-message heuristic)
            if (!isWeakMessage(data.content)) {
                try {
                    const clarifyResult = await pythonClient.clarify(data.content);
                    Sentry.addBreadcrumb({ category: 'chat.clarify', message: 'Clarify check complete', level: 'info', data: { chatId, should_clarify: clarifyResult.should_clarify, questions: clarifyResult.questions.length, is_complex: clarifyResult.is_complex } });
                    logger.info(logger.fmt`chat.clarify_result chatId=${chatId ?? ''} should_clarify=${clarifyResult.should_clarify} questions=${clarifyResult.questions.length}`);
                    if (clarifyResult.should_clarify && clarifyResult.questions.length > 0) {
                        pendingClarifications.set(chatId!, {
                            data,
                            chatId: chatId!,
                            customInstructions,
                            messagesContext,
                        });
                        Sentry.addBreadcrumb({ category: 'chat.clarify', message: 'Clarification required — pausing optimization', level: 'info', data: { chatId, questionCount: clarifyResult.questions.length } });
                        if (appWindowManager) {
                            appWindowManager.send('clarification-required', { chatId, ...clarifyResult });
                        }
                        return;
                    }
                } catch (clarifyErr) {
                    Sentry.captureException(clarifyErr, { tags: { component: 'chat-handlers', op: 'clarify' }, level: 'warning' });
                    logger.warn(logger.fmt`chat.clarify_failed chatId=${chatId ?? ''} error=${clarifyErr instanceof Error ? clarifyErr.message : String(clarifyErr)}`);
                }
            }

            // Trigger streaming optimization — uses the original attachedFiles (with
            // base64) so the LLM sees the image content regardless of upload status.
            activeGenerations.set(chatId!, { accumulated: '' });
            let optimizedText: string;
            let modelsUsed: ModelsUsed | undefined;
            Sentry.addBreadcrumb({ category: 'chat', message: 'Streaming started', level: 'info', data: { chatId, mode: data.mode } });
            logger.info(logger.fmt`chat.streaming_started chatId=${chatId ?? ''} mode=${data.mode ?? 'thinking'}`);
            try {
                const result = await pythonClient.optimizeStream(
                    data.content,
                    false,
                    messagesContext.length > 0 ? messagesContext : null,
                    (chunk, accumulated) => {
                        activeGenerations.set(chatId!, { accumulated });
                        if (appWindowManager) {
                            appWindowManager.send('optimization-chunk', { chatId, chunk, accumulated });
                        }
                    },
                    data.mode || 'thinking',
                    customInstructions,
                    attachedFiles,
                    data.forcedSkill || null,
                    null,
                    null,
                    false,
                    getActiveProjectId(),
                    getActiveProjectBranch(),
                );
                optimizedText = result.text;
                modelsUsed = result.models;
                Sentry.addBreadcrumb({ category: 'chat', message: 'Streaming completed', level: 'info', data: { chatId } });
                logger.info(logger.fmt`chat.streaming_complete chatId=${chatId ?? ''}`);
            } catch (llmErr: any) {
                activeGenerations.delete(chatId!);
                const friendlyError = humanizeLlmError(llmErr);
                try {
                    await chatService.addMessage(chatId, '', 'assistant', undefined, {
                        isError: true,
                        errorMessage: friendlyError,
                        groupId: crypto.randomUUID(),
                        versionIndex: 0,
                    });
                } catch { /* non-critical — best-effort */ }
                throw llmErr;
            }
            activeGenerations.delete(chatId!);

            // Save optimization record and trigger background memory analysis
            let optimizationId: string | undefined;
            if (authState.isAuthenticated) {
                try {
                    const optimization = await optimizationService.saveOptimization(
                        data.content,
                        optimizedText,
                        'app_window',
                        { ...buildModelMeta(modelsUsed), source_context: { app: 'app_window', chat_id: chatId } }
                    );
                    optimizationId = optimization.id;
                    if (analyzer && authState.currentUserId) {
                        analyzer.onNewOptimization(
                            authState.currentUserId,
                            data.content,
                            optimizedText,
                            data.forcedSkill || null,
                        ).catch((e: unknown) =>
                            console.warn('[Memory] Analyzer error (non-critical):', e)
                        );
                    }
                } catch (dbError) {
                    console.error('[Chat] Failed to save optimization record:', dbError);
                }
            }

            // Save assistant message
            const assistantGroupId = crypto.randomUUID();
            const assistantMessage = await chatService.addMessage(
                chatId,
                optimizedText,
                'assistant',
                optimizationId,
                { ...buildModelMeta(modelsUsed), optimized: true, groupId: assistantGroupId, versionIndex: 0 }
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
                        groupId: assistantGroupId,
                        versionIndex: 0,
                    }
                });
            }

            analyticsService.logEvent('ai_response', { source: 'app', model: modelsUsed?.optimizer });

            // Invalidate rate-limit cache so the next check reflects the new message
            if (authState.currentUserId && rateLimitService) {
                rateLimitService.invalidateCache(authState.currentUserId);
            }

            // Reload chats list to update timestamps
            const chats = await chatService.getChats();
            if (appWindowManager) {
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            Sentry.captureException(error);
            console.error('[Chat] Failed to send message:', error);
            if (appWindowManager) {
                appWindowManager.send('message-send-error', {
                    error: humanizeLlmError(error),
                });
            }
        }
        });
    });

    // ============================================
    // APP WINDOW: Submit clarification answers (resumes paused optimization)
    // ============================================
    ipcMain.on('app:submit-clarification', async (event, data: {
        chatId: string;
        answers: Record<string, string>;
        wantsSections: boolean;
        clarificationChoices?: { questions: any[]; answers: Record<string, string>; mode: string };
    }) => {
        const pending = pendingClarifications.get(data.chatId);
        if (!pending) {
            console.warn('[Chat] submit-clarification: no pending optimization for chatId', data.chatId);
            Sentry.addBreadcrumb({ category: 'chat.clarify', message: 'submit-clarification: no pending optimization', level: 'warning', data: { chatId: data.chatId } });
            return;
        }
        pendingClarifications.delete(data.chatId);

        const formattedAnswers = formatClarificationAnswers(data.answers);

        Sentry.addBreadcrumb({ category: 'chat.clarify', message: 'Clarification submitted — resuming optimization', level: 'info', data: { chatId: data.chatId, wantsSections: data.wantsSections, answerCount: Object.keys(data.answers).length } });
        logger.info(logger.fmt`chat.clarification_submitted chatId=${data.chatId} wantsSections=${data.wantsSections} answerCount=${Object.keys(data.answers).length}`);

        try {
            activeGenerations.set(data.chatId, { accumulated: '' });
            let optimizedText: string;
            let modelsUsed: ModelsUsed | undefined;

            try {
                const result = await pythonClient.optimizeStream(
                    pending.data.content,
                    false,
                    pending.messagesContext.length > 0 ? pending.messagesContext : null,
                    (chunk, accumulated) => {
                        activeGenerations.set(data.chatId, { accumulated });
                        if (appWindowManager) {
                            appWindowManager.send('optimization-chunk', { chatId: data.chatId, chunk, accumulated });
                        }
                    },
                    pending.data.mode || 'thinking',
                    pending.customInstructions,
                    pending.data.attachedFiles || [],
                    pending.data.forcedSkill || null,
                    null,
                    formattedAnswers || null,
                    data.wantsSections,
                    getActiveProjectId(),
                    getActiveProjectBranch(),
                );
                optimizedText = result.text;
                modelsUsed = result.models;
            } catch (llmErr: any) {
                activeGenerations.delete(data.chatId);
                const friendlyError = humanizeLlmError(llmErr);
                try {
                    await chatService.addMessage(data.chatId, '', 'assistant', undefined, {
                        isError: true,
                        errorMessage: friendlyError,
                        groupId: crypto.randomUUID(),
                        versionIndex: 0,
                    });
                } catch { /* non-critical */ }
                throw llmErr;
            }
            activeGenerations.delete(data.chatId);

            let optimizationId: string | undefined;
            if (authState.isAuthenticated) {
                try {
                    const optimization = await optimizationService.saveOptimization(
                        pending.data.content,
                        optimizedText,
                        'app_window',
                        { ...buildModelMeta(modelsUsed), source_context: { app: 'app_window', chat_id: data.chatId } }
                    );
                    optimizationId = optimization.id;
                    if (analyzer && authState.currentUserId) {
                        analyzer.onNewOptimization(
                            authState.currentUserId,
                            pending.data.content,
                            optimizedText,
                            pending.data.forcedSkill || null,
                        ).catch((e: unknown) =>
                            console.warn('[Memory] Analyzer error (non-critical):', e)
                        );
                    }
                } catch (dbError) {
                    console.error('[Chat] Failed to save optimization record:', dbError);
                }
            }

            const assistantGroupId = crypto.randomUUID();
            const assistantMeta: Record<string, any> = {
                ...buildModelMeta(modelsUsed), optimized: true, groupId: assistantGroupId, versionIndex: 0,
            };
            if (data.clarificationChoices) {
                assistantMeta.clarificationChoices = data.clarificationChoices;
            }
            const assistantMessage = await chatService.addMessage(
                data.chatId,
                optimizedText,
                'assistant',
                optimizationId,
                assistantMeta
            );

            if (appWindowManager) {
                appWindowManager.send('message-received', {
                    chatId: data.chatId,
                    message: {
                        id: assistantMessage.id,
                        chatId: assistantMessage.chat_id,
                        role: assistantMessage.role,
                        content: assistantMessage.content,
                        createdAt: assistantMessage.created_at,
                        groupId: assistantGroupId,
                        versionIndex: 0,
                    }
                });
            }

            analyticsService.logEvent('ai_response', { source: 'app', model: modelsUsed?.optimizer });

            if (authState.currentUserId && rateLimitService) {
                rateLimitService.invalidateCache(authState.currentUserId);
            }

            const chats = await chatService.getChats();
            if (appWindowManager) {
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            Sentry.captureException(error);
            console.error('[Chat] Clarification optimization failed:', error);
            if (appWindowManager) {
                appWindowManager.send('message-send-error', {
                    error: humanizeLlmError(error),
                });
            }
        }
    });

    // ============================================
    // APP WINDOW: Regenerate assistant response (no new user message)
    // ============================================
    ipcMain.on('app:regenerate-response', async (event, data: {
        chatId: string;
        content: string;
        mode?: string;
        groupId?: string;
        versionIndex?: number;
        attachedFiles?: AttachedFile[];
        forcedSkill?: string | null;
        previousContent?: string;
        clarificationAnswers?: string;
        wantsSections?: boolean;
        clarificationChoices?: { questions: any[]; answers: Record<string, string>; mode: string };
    }) => {
        Sentry.addBreadcrumb({ category: 'chat', message: 'Regenerate requested', level: 'info', data: { chatId: data.chatId, mode: data.mode } });
        logger.info(logger.fmt`chat.regenerate_requested chatId=${data.chatId} mode=${data.mode ?? 'thinking'}`);
        try {
            // ── Rate limit guard ──────────────────────────────────────────────
            if (authState.isAuthenticated && authState.currentUserId && rateLimitService) {
                try {
                    const rl = await rateLimitService.checkRateLimit(authState.currentUserId);
                    if (!rl.allowed) {
                        console.warn(`[Chat] Rate limit exceeded for regeneration (${rl.limit - rl.remaining}/${rl.limit})`);
                        if (appWindowManager) {
                            appWindowManager.send('message-send-error', {
                                error: `Daily message limit reached (${rl.limit}/${rl.limit}). Your limit resets at midnight UTC.`,
                            });
                        }
                        return;
                    }
                } catch (rlErr) {
                    console.warn('[Chat] Rate limit check failed (allowing regeneration):', rlErr);
                    Sentry.captureMessage('Rate limit fail-open', 'warning');
                    logger.warn('chat.regenerate_rate_limit_check_failed — allowing through');
                }
            }

            const chatId = data.chatId;
            const attachedFiles = data.attachedFiles || [];

            // Fetch custom instructions
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
            if (authState.isAuthenticated && memory && analyzer) {
                try {
                    const memEnabled = await analyzer.isMemoryEnabled();
                    if (memEnabled) {
                        const memCtx = await memory.buildMemoryContext();
                        if (memCtx) customInstructions = customInstructions ? `${customInstructions}\n\n${memCtx}` : memCtx;
                    }
                } catch { /* non-critical */ }
            }

            // Fetch chat history for context
            let messagesContext: Array<{role: string, content: string}> = [];
            try {
                const history = await chatService.getMessages(chatId);
                const relevantHistory = history.slice(-10);
                messagesContext = relevantHistory.map(m => ({
                    role: m.role,
                    content: m.content
                }));
            } catch (historyErr) {
                console.warn('[Chat] Failed to fetch chat history for context:', historyErr);
            }

            // Trigger streaming optimization (regeneration — pass previous content for self-critique)
            activeGenerations.set(chatId, { accumulated: '' });
            let optimizedText: string;
            let modelsUsed: ModelsUsed | undefined;
            try {
                const result = await pythonClient.optimizeStream(
                    data.content,
                    true,
                    messagesContext.length > 0 ? messagesContext : null,
                    (chunk, accumulated) => {
                        activeGenerations.set(chatId, { accumulated });
                        if (appWindowManager) {
                            appWindowManager.send('optimization-chunk', { chatId, chunk, accumulated });
                        }
                    },
                    data.mode || 'thinking',
                    customInstructions,
                    attachedFiles,
                    data.forcedSkill || null,
                    data.previousContent || null,
                    data.clarificationAnswers || null,
                    data.wantsSections ?? false,
                    getActiveProjectId(),
                    getActiveProjectBranch(),
                );
                optimizedText = result.text;
                modelsUsed = result.models;
            } finally {
                activeGenerations.delete(chatId);
            }

            // Save optimization record
            let optimizationId: string | undefined;
            if (authState.isAuthenticated) {
                try {
                    const optimization = await optimizationService.saveOptimization(
                        data.content,
                        optimizedText,
                        'app_window',
                        { ...buildModelMeta(modelsUsed), source_context: { app: 'app_window', chat_id: chatId } }
                    );
                    optimizationId = optimization.id;
                    if (analyzer && authState.currentUserId) {
                        analyzer.onNewOptimization(
                            authState.currentUserId,
                            data.content,
                            optimizedText,
                            data.forcedSkill || null,
                        ).catch((e: unknown) =>
                            console.warn('[Memory] Analyzer error (non-critical):', e)
                        );
                    }
                } catch (dbError) {
                    console.error('[Chat] Failed to save optimization record:', dbError);
                }
            }

            // Save assistant message with the caller-provided groupId
            const assistantGroupId = data.groupId || crypto.randomUUID();
            const assistantVersionIndex = data.versionIndex ?? 0;
            const regenMeta: Record<string, any> = {
                ...buildModelMeta(modelsUsed), optimized: true, groupId: assistantGroupId, versionIndex: assistantVersionIndex,
            };
            if (data.clarificationChoices) {
                regenMeta.clarificationChoices = data.clarificationChoices;
            }
            const assistantMessage = await chatService.addMessage(
                chatId,
                optimizedText,
                'assistant',
                optimizationId,
                regenMeta
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
                        groupId: assistantGroupId,
                        versionIndex: assistantVersionIndex,
                    }
                });
            }

            analyticsService.logEvent('ai_response', { source: 'app', regeneration: true });

            // Invalidate rate-limit cache after regeneration
            if (authState.currentUserId && rateLimitService) {
                rateLimitService.invalidateCache(authState.currentUserId);
            }

            // Reload chats list to update timestamps
            const chats = await chatService.getChats();
            if (appWindowManager) {
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            Sentry.captureException(error);
            console.error('[Chat] Failed to regenerate response:', error);
            if (appWindowManager) {
                appWindowManager.send('message-send-error', {
                    error: humanizeLlmError(error),
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
            Sentry.captureException(error);
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
        activeGenerations.clear();
    });

    // ============================================
    // APP WINDOW: Check if a chat has an active generation (for stream resumption)
    // ============================================
    ipcMain.handle('app:get-generation-status', (_event, chatId: string) => {
        const gen = activeGenerations.get(chatId);
        return gen
            ? { isActive: true, accumulated: gen.accumulated }
            : { isActive: false, accumulated: '' };
    });

    // ============================================
    // APP WINDOW: Get rate limit status
    // ============================================
    ipcMain.handle('app:get-rate-limit-status', async () => {
        if (!authState.isAuthenticated || !authState.currentUserId || !rateLimitService) {
            return { allowed: true, remaining: Infinity, limit: Infinity, role: 'unknown' };
        }
        try {
            return await rateLimitService.checkRateLimit(authState.currentUserId);
        } catch (err) {
            console.warn('[Chat] Rate limit status query failed:', err);
            return { allowed: true, remaining: Infinity, limit: Infinity, role: 'unknown' };
        }
    });
}

// ============================================
// OFFLINE QUEUE: Drain queued send-message ops
// ============================================
// Called by index-new.ts whenever the network comes back online.
// Processes only `send-message` entries; other types are handled by
// syncOfflineQueue in prompt-library-handlers.ts.
export async function syncChatMessageQueue(
    _appWindowManager: AppWindowManager,
    _pythonClient: PythonClient,
): Promise<void> {
    const pending = offlineQueue.getAll().filter(op => op.type === 'send-message');
    if (pending.length === 0) return;

    console.log(`[ChatOfflineSync] Processing ${pending.length} queued send-message ops`);

    // Use module-level service singletons (initialized when registerChatHandlers ran)
    const { chatService: svc, optimizationService: optSvc } = getServices();

    for (const op of pending) {
        const { chatId, content, mode, forcedSkill, groupId, versionIndex } = op.payload as {
            chatId: string;
            content: string;
            mode?: string;
            forcedSkill?: string | null;
            groupId?: string;
            versionIndex?: number;
        };

        try {
            if (!authState.isAuthenticated || !authState.currentUserId) {
                console.warn('[ChatOfflineSync] Not authenticated — deferring op', op.id);
                continue;
            }

            // Save user message — use the stable op.id as the pre-generated message UUID.
            // If a previous sync attempt already wrote this message, the insert will
            // conflict on the primary key and be skipped (idempotent replay).
            const userGroupId = groupId || crypto.randomUUID();
            const userVersionIndex = versionIndex ?? 0;
            const userMsg = await svc.addMessage(chatId, content, 'user', undefined, {
                groupId: userGroupId,
                versionIndex: userVersionIndex,
            }, op.id /* stable idempotency key */);

            // Fetch context
            let messagesContext: Array<{role: string; content: string}> = [];
            try {
                const history = await svc.getMessages(chatId);
                messagesContext = history
                    .filter(m => m.id !== userMsg.id)
                    .slice(-10)
                    .map(m => ({ role: m.role, content: m.content }));
            } catch { /* non-critical */ }

            // Run optimizer (background sync — no streaming)
            const { text: optimizedText, models: modelsUsed } = await _pythonClient.optimizeStream(
                content,
                false,
                messagesContext.length > 0 ? messagesContext : null,
                () => { /* no-op chunk callback */ },
                mode || 'thinking',
                '',
                [],
                forcedSkill || null,
                null,
                null,
                false,
                getActiveProjectId(),
                getActiveProjectBranch(),
            );

            // Save optimization record
            let optimizationId: string | undefined;
            try {
                const opt = await optSvc.saveOptimization(
                    content, optimizedText, 'app_window',
                    { ...buildModelMeta(modelsUsed), source_context: { app: 'app_window', chat_id: chatId } }
                );
                optimizationId = opt.id;
            } catch { /* non-critical */ }

            // Save assistant message
            const assistantGroupId = crypto.randomUUID();
            const assistantMsg = await svc.addMessage(
                chatId, optimizedText, 'assistant', optimizationId,
                { ...buildModelMeta(modelsUsed), optimized: true, groupId: assistantGroupId, versionIndex: 0 }
            );

            // Notify the app window so it can append the messages
            _appWindowManager.send('offline-message-synced', {
                chatId,
                userMessage: {
                    id: userMsg.id, chatId, role: 'user', content,
                    createdAt: userMsg.created_at, groupId: userGroupId, versionIndex: userVersionIndex,
                },
                assistantMessage: {
                    id: assistantMsg.id, chatId, role: 'assistant', content: optimizedText,
                    createdAt: assistantMsg.created_at, groupId: assistantGroupId, versionIndex: 0,
                },
            });

            offlineQueue.remove(op.id);
            console.log(`[ChatOfflineSync] ✅ Synced queued message for chat ${chatId}`);
        } catch (err) {
            console.warn(`[ChatOfflineSync] Failed to sync op ${op.id} — will retry:`, err);
            Sentry.captureException(err, { tags: { component: 'offline-sync-chat' }, extra: { opId: op.id } });
            offlineQueue.incrementRetry(op.id);
        }
    }
}

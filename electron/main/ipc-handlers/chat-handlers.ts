import { ipcMain } from 'electron';
import crypto from 'crypto';
import FileType from 'file-type';
import { spaceStreamStore } from '../services/space-stream-store';
import { ChatService } from '../database/services/chat-service';
import { OptimizationService } from '../database/services/optimization-service';
import { AppWindowManager } from '../windows/app-window-manager';
import { PythonClient, ModelsUsed, ClarifyResult } from '../api/python-client';
import { aiSettings } from '../database/services/ai-settings-service';
import { authState } from '../utils/auth-state';
import { SettingsService } from '../database/services/settings-service';
import { UserService } from '../database/services/user-service';
import { MemoryService } from '../database/services/memory-service';
import { MemoryAnalyzer } from '../database/services/memory-analyzer';
import { networkMonitor } from '../ipc-handlers/network-monitor-singleton';
import { saveAttachment } from './file-upload-service';
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

/** Patterns that identify greeting/small-talk openers. */
const GREETING_PATTERNS = [
  /^(hi|hello|hey|howdy|hiya|yo|sup|helo+|he+y+|h+i+)\b/i,
  /^how\s+(are\s+(you|u)|r\s+u|is\s+it\s+going|have\s+you\s+been)/i,
  /^what'?s\s+up/i,
  /^good\s+(morning|afternoon|evening|day|night)/i,
  /^greetings?\b/i,
];

/**
 * Return a human-readable default title for messages that are too generic to
 * pass to the LLM title generator, so the chat doesn't stay as "New Chat".
 */
export function classifyWeakMessage(content: string): string {
  const trimmed = content.trim();
  if (GREETING_PATTERNS.some(p => p.test(trimmed))) return 'Greeting';
  return 'New Chat';
}

/**
 * Titles that are considered generic/placeholder and eligible for replacement
 * when a better signal arrives in a follow-up message.
 */
export const GENERIC_TITLES = new Set(['New Chat', 'Greeting']);

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
  // Messages python-service wrote for the user (missing/rejected API key,
  // unknown model, project context unavailable) are shown as-is.
  if (err?.name === 'ServiceError' && err.message) return err.message;

  const raw: string = (err?.message ?? err?.code ?? String(err)).toLowerCase();

  if (raw.includes('econnrefused') || raw.includes('econnreset') || raw.includes('enotfound')) {
    return 'The local AI service is not reachable. Make sure python-service is running (npm run python:dev) and try again.';
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

/**
 * Why an AI request can't be sent right now (no API key, or offline), or null.
 */
function aiReadinessError(): string | null {
  if (!aiSettings.isConfigured()) {
    return 'Add your OpenRouter API key in Settings > AI provider to start optimizing prompts.';
  }
  if (!networkMonitor.isOnline) {
    return "You're offline. Prmpt needs an internet connection to reach OpenRouter.";
  }
  return null;
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

function getServices(pythonClient?: PythonClient, appWindowManager?: AppWindowManager) {
    if (!chatService) chatService = new ChatService();
    if (!optimizationService) optimizationService = new OptimizationService();
    if (!userService) userService = new UserService();
    if (!settingsService) settingsService = new SettingsService();
    if (!memoryService) memoryService = new MemoryService();
    if (!memoryAnalyzer && pythonClient) {
        memoryAnalyzer = new MemoryAnalyzer(pythonClient, memoryService, settingsService, userService, appWindowManager);
    }
    return { chatService, optimizationService, userService, settingsService, memoryService, memoryAnalyzer };
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
    const { chatService, optimizationService, userService, settingsService, memoryService: memory, memoryAnalyzer: analyzer } = getServices(pythonClient, appWindowManager);

    // ============================================
    // APP WINDOW: Optimize prompt request
    // ============================================
    ipcMain.on('app:optimize-prompt', async (event, promptText: string, isRegenerate: boolean = false, chatId?: string, mode: string = 'thinking', source: 'chat' | 'space' = 'chat', spaceId?: string, projectId?: string, projectBranch?: string) => {
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

            // Register space stream state so SpaceWorkspace can resume if it remounts mid-stream.
            if (source === 'space' && spaceId) {
                spaceStreamStore.register(spaceId);
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
                        if (source === 'space' && spaceId) {
                            spaceStreamStore.update(spaceId, accumulated);
                        }
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
                    source === 'space' ? (projectId || null) : getActiveProjectId(),
                    source === 'space' ? (projectBranch || null) : getActiveProjectBranch(),
                );
                optimizedText = result.text;
                modelsUsed = result.models;
                // Mark the space stream complete only on success — errors are
                // handled in the outer catch which calls spaceStreamStore.error().
                if (source === 'space' && spaceId) {
                    spaceStreamStore.complete(spaceId);
                }
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

        } catch (error) {
            console.error('[Chat] Optimization failed:', error);
            if (source === 'space' && spaceId) {
                spaceStreamStore.error(spaceId);
            }
            if (appWindowManager) {
                appWindowManager.send('optimization-error', {
                    error: humanizeLlmError(error),
                    source,
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
    ipcMain.on('app:load-chats', async () => {
        try {
            const chats = await chatService.getChats();
            if (appWindowManager) appWindowManager.send('chats-loaded', { chats });
        } catch (error) {
            console.error('[Chat] Failed to load chats:', error);
            if (appWindowManager) appWindowManager.send('chats-loaded', { chats: [], error: String(error) });
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
            if (appWindowManager) appWindowManager.send('messages-loaded', { chatId, messages });
        } catch (error) {
            console.error('[Chat] Failed to load messages:', error);
            if (appWindowManager) appWindowManager.send('messages-loaded', { chatId, messages: [], error: String(error) });
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
            const errorMessage = 'Something went wrong. Please try again.';
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
            const errorMessage = 'Something went wrong. Please try again.';
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
        try {
            const readinessError = aiReadinessError();
            if (readinessError) {
                if (appWindowManager) appWindowManager.send('message-send-error', { error: readinessError });
                return;
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
                // Use first 4 words as a visible placeholder; LLM title arrives shortly after.
                const placeholderTitle = data.content.trim().split(/\s+/).slice(0, 4).join(' ') || 'New Chat';
                chat = await chatService.createChat(placeholderTitle);
                chatId = chat.id;
            } else {
                chat = await chatService.getChat(chatId);
            }

            // Fire-and-forget: update the title for every one of the first 3 user
            // messages using the full conversation so far for the best context.
            (async () => {
                try {
                    const prevUserMsgs = (await chatService.getMessages(chatId!))
                        .filter(m => m.role === 'user');

                    if (prevUserMsgs.length < 3) {
                        const combinedContent = [
                            ...prevUserMsgs.map(m => m.content),
                            data.content,
                        ].filter(s => s.trim()).join('\n').slice(0, 300);

                        if (combinedContent.trim()) {
                            const smartTitle = await pythonClient.generateTitle(combinedContent);
                            if (smartTitle && smartTitle !== 'New Chat') {
                                await chatService.updateChatTitle(chatId!, smartTitle);
                                if (appWindowManager) {
                                    appWindowManager.send('chat-renamed', {
                                        chatId: chatId!,
                                        title: smartTitle,
                                    });
                                }
                                console.log(`[Chat] Title updated (msg ${prevUserMsgs.length + 1}/3): "${smartTitle}"`);
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[Chat] Title generation failed (non-critical):', err);
                }
            })();

            // ── Insert message + notify renderer FIRST, upload in background ──
            // Strategy: DB INSERT with file metadata (no URLs) → fire message-sent
            // → start uploads in parallel with optimization. This ensures the
            // renderer shows the user message instantly and DB reloads find it.
            const userGroupId = data.groupId || crypto.randomUUID();
            const userVersionIndex = data.versionIndex ?? 0;
            const preGeneratedMessageId = crypto.randomUUID();

            // Insert message to DB with file metadata only (name/type/size).
            // Local storage paths are backfilled once the files are saved.
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

            // Fire-and-forget: save attachments to the user-data folder so they can be
            // reopened later; the current session shows thumbnails from in-memory base64.
            if (attachedFiles.length > 0) {
                (async () => {
                    try {
                        const results = await Promise.allSettled(
                            attachedFiles.map(f => saveAttachment(f, chatId!, preGeneratedMessageId))
                        );
                        const filesForDb = results.map((r, i) => {
                            if (r.status === 'fulfilled') return r.value;
                            const uploadErr = (r as PromiseRejectedResult).reason;
                            console.error(`[Chat] Saving attachment "${attachedFiles[i].name}" failed:`, uploadErr?.message);
                            return { name: attachedFiles[i].name, mimeType: attachedFiles[i].mimeType, sizeBytes: attachedFiles[i].sizeBytes, uploadFailed: true };
                        });
                        await chatService.updateMessageAttachments(userMessage.id, filesForDb);
                        const succeeded = filesForDb.filter((f: any) => !f.uploadFailed).length;
                        const chatFailedNames = filesForDb.filter((f: any) => f.uploadFailed).map((f: any) => f.name);
                        if (chatFailedNames.length > 0 && appWindowManager) {
                            appWindowManager.send('upload-partial-failure', { failedFiles: chatFailedNames });
                        }
                    } catch (bgErr) {
                        console.error('[Chat] Saving attachments failed:', bgErr);
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
                    if (clarifyResult.should_clarify && clarifyResult.questions.length > 0) {
                        pendingClarifications.set(chatId!, {
                            data,
                            chatId: chatId!,
                            customInstructions,
                            messagesContext,
                        });
                        if (appWindowManager) {
                            appWindowManager.send('clarification-required', { chatId, ...clarifyResult });
                        }
                        return;
                    }
                } catch (clarifyErr) {
                    console.error(clarifyErr);
                }
            }

            // Trigger streaming optimization — uses the original attachedFiles (with
            // base64) so the LLM sees the image content regardless of upload status.
            activeGenerations.set(chatId!, { accumulated: '' });
            let optimizedText: string;
            let modelsUsed: ModelsUsed | undefined;
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



            // Reload chats list to update timestamps
            const chats = await chatService.getChats();
            if (appWindowManager) {
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
            console.error('[Chat] Failed to send message:', error);
            if (appWindowManager) {
                appWindowManager.send('message-send-error', {
                    error: humanizeLlmError(error),
                });
            }
        }
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
            return;
        }
        pendingClarifications.delete(data.chatId);

        const formattedAnswers = formatClarificationAnswers(data.answers);


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



            const chats = await chatService.getChats();
            if (appWindowManager) {
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
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
        try {
            const readinessError = aiReadinessError();
            if (readinessError) {
                if (appWindowManager) appWindowManager.send('message-send-error', { error: readinessError });
                return;
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



            // Reload chats list to update timestamps
            const chats = await chatService.getChats();
            if (appWindowManager) {
                appWindowManager.send('chats-loaded', { chats });
            }
        } catch (error) {
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
    // SPACES: Get active stream state for a space (for mid-stream remount resumption)
    //
    // Called by SpaceWorkspace on mount. If a generation is in flight for
    // this space, returns the accumulated content so far and marks the stream
    // as taken over — signalling the previous mount's self-removing completion
    // handler to skip its localStorage persistence (the new mount will handle it).
    // ============================================
    ipcMain.handle('spaces:get-active-stream', (_event, spaceId: string) => {
        const state = spaceStreamStore.get(spaceId);
        if (!state) return null;
        // If the stream completed while the component was unmounted, return
        // the finished content so the new mount can persist it. Clear the
        // entry since the renderer will handle saving from here.
        if (state.isComplete) {
            spaceStreamStore.clear(spaceId);
            return state;
        }
        spaceStreamStore.markTakenOver(spaceId);
        return state;
    });

}

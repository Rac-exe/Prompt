import { ipcMain, clipboard, screen } from 'electron';
import * as Sentry from '@sentry/electron/main';
import * as crypto from 'crypto';
import { OverlayWindowManager } from '../overlay/overlay-window-manager';
import { PythonClient, ModelsUsed } from '../api/python-client';
import { AppWindowManager } from '../windows/app-window-manager';
import { PromptLibraryService } from '../database/services/prompt-library-service';
import { OptimizationService } from '../database/services/optimization-service';
import { ChatService } from '../database/services/chat-service';
import { authState } from '../utils/auth-state';
import { replaceAtLastAnchor, isNativeBridgeAvailable } from '../utils/native-bridge';
import { SettingsService } from '../database/services/settings-service';
import { UserService } from '../database/services/user-service';
import { localCache } from '../database/local-cache';
import { networkMonitor } from './network-monitor-singleton';
import { offlineQueue } from '../database/offline-queue';
import { uploadAttachment } from './file-upload-service';
import { errorLog } from '../database/error-log';
import { MemoryService } from '../database/services/memory-service';
import { MemoryAnalyzer } from '../database/services/memory-analyzer';
import { RateLimitService } from '../database/services/rate-limit-service';
import { buildTitlePrompt } from './chat-handlers';

function buildModelMeta(models?: ModelsUsed): Record<string, unknown> {
    return {
        model: models?.optimizer ?? 'unknown',
        ...(models?.summarizer && { summarizer_model: models.summarizer }),
        ...(models?.used_vision && { used_vision: true }),
    };
}

// ============================================
// OVERLAY IPC HANDLERS
// ============================================
//
// IPC Contract:
//
// Renderer → Main (send / invoke):
//   overlay:optimize   — Start prompt optimization (streaming)
//   overlay:save       — Save optimized prompt to library (invoke, returns result)
//   overlay:copy       — Copy text to clipboard
//   overlay:close      — Hide the overlay
//   overlay:open-app   — Show the main app window (e.g. for login)
//   overlay:check-auth — Check current auth state (invoke, returns boolean)
//   overlay:get-collections — Get prompt library collections (invoke)
//
// Main → Renderer (send):
//   overlay:opened                — Overlay was opened (includes auth state)
//   overlay:auth-state            — Auth state update
//   overlay:optimization-chunk    — Streaming optimization chunk
//   overlay:optimization-complete — Optimization finished
//   overlay:optimization-error    — Optimization failed
//
// Renderer → Main (invoke, with return value):
//   overlay:insert  — Close overlay + inject optimized text into original window

// Lazy-load services (created after Supabase init)
let promptLibraryService: PromptLibraryService | null = null;
let optimizationService: OptimizationService | null = null;

function getPromptLibraryService(): PromptLibraryService {
  if (!promptLibraryService) promptLibraryService = new PromptLibraryService();
  return promptLibraryService;
}

function getOptimizationService(): OptimizationService {
  if (!optimizationService) optimizationService = new OptimizationService();
  return optimizationService;
}

let settingsService: SettingsService | null = null;
function getSettingsService(): SettingsService {
  if (!settingsService) settingsService = new SettingsService();
  return settingsService;
}

let userService: UserService | null = null;
function getUserService(): UserService {
  if (!userService) userService = new UserService();
  return userService;
}

let memoryService: MemoryService | null = null;
function getMemoryService(): MemoryService {
  if (!memoryService) memoryService = new MemoryService();
  return memoryService;
}

let memoryAnalyzer: MemoryAnalyzer | null = null;
function getMemoryAnalyzer(pythonClient: PythonClient, appWindowManager: AppWindowManager): MemoryAnalyzer {
  if (!memoryAnalyzer) {
    memoryAnalyzer = new MemoryAnalyzer(
      pythonClient,
      getMemoryService(),
      getSettingsService(),
      getUserService(),
      appWindowManager,
    );
  }
  return memoryAnalyzer;
}

// Simple in-memory history for the overlay session so the user can refine prompts
const inMemoryOverlayHistory: Array<{role: string, content: string}> = [];

// Track the current overlay session's chat ID so all messages go to the same chat
let currentOverlayChatId: string | null = null;

let chatService: ChatService | null = null;
function getChatService(): ChatService {
  if (!chatService) chatService = new ChatService();
  return chatService;
}

let rateLimitService: RateLimitService | null = null;
function getRateLimitService(): RateLimitService {
  if (!rateLimitService) rateLimitService = new RateLimitService();
  return rateLimitService;
}

/** Clear overlay conversation history and reset chat session (called on "New Session"). */
function clearOverlayHistory() {
  inMemoryOverlayHistory.length = 0;
  currentOverlayChatId = null;
  console.log('[OverlayHandlers] Overlay session history cleared');
}

// Cursor polling interval reference (so we can clear it)
let cursorPollInterval: ReturnType<typeof setInterval> | null = null;

export function startCursorPolling(overlayManager: OverlayWindowManager) {
  if (cursorPollInterval) return; // already running
  cursorPollInterval = setInterval(() => {
    if (!overlayManager.isVisible()) return;
    const win = overlayManager.getWindow();
    if (!win || win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const [winX, winY] = win.getPosition();
    // Send cursor position relative to the overlay window
    overlayManager.send('overlay:cursor-pos', {
      x: cursor.x - winX,
      y: cursor.y - winY,
    });
  }, 16); // ~60fps
}

export function stopCursorPolling() {
  if (cursorPollInterval) {
    clearInterval(cursorPollInterval);
    cursorPollInterval = null;
  }
}

export function registerOverlayHandlers(
  overlayManager: OverlayWindowManager,
  pythonClient: PythonClient,
  appWindowManager: AppWindowManager
) {
  // Start cursor polling for the glow effect
  startCursorPolling(overlayManager);

  // ============================================
  // overlay:optimize — Run prompt optimization with streaming
  // ============================================
  ipcMain.on('overlay:optimize', async (_event, data: { text: string; isRegenerate?: boolean; mode?: string; chatId?: string; attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>; forcedSkill?: string; userGroupId?: string; userVersionIndex?: number; assistantGroupId?: string; assistantVersionIndex?: number; previousOutput?: string }) => {
    Sentry.addBreadcrumb({ category: 'overlay', message: 'Optimize requested', level: 'info', data: { mode: data.mode, skill: data.forcedSkill, isRegenerate: data.isRegenerate } });
    if (!authState.isAuthenticated) {
      overlayManager.send('overlay:optimization-error', { error: 'Not authenticated' });
      return;
    }

    if (!data?.text?.trim()) {
      overlayManager.send('overlay:optimization-error', { error: 'Empty prompt' });
      return;
    }

    // ── Offline guard ────────────────────────────────────────────────────────
    if (!networkMonitor.isOnline) {
      const hasFiles = (data.attachedFiles?.length ?? 0) > 0;
      if (hasFiles) {
        overlayManager.send('overlay:optimization-error', {
          error: 'You are offline. File attachments cannot be sent without a network connection.',
        });
        return;
      }
      // Text-only: fall through — the Python client will fail with a connection
      // error which is caught and forwarded to the renderer via optimization-error.
    }

    // ── Rate limit guard ──────────────────────────────────────────────────
    if (authState.currentUserId) {
      try {
        const rl = getRateLimitService().checkRateLimit(authState.currentUserId);
        const result = await rl;
        if (!result.allowed) {
          console.warn(`[Overlay] Rate limit exceeded for user ${authState.currentUserId} (${result.limit - result.remaining}/${result.limit})`);
          overlayManager.send('overlay:optimization-error', {
            error: `Daily message limit reached (${result.limit}/${result.limit}). Your limit resets at midnight UTC.`,
          });
          return;
        }
      } catch (rlErr) {
        console.warn('[Overlay] Rate limit check failed (allowing message):', rlErr);
        Sentry.captureMessage('Rate limit fail-open', 'warning');
      }
    }

    // Handle session reset if the overlay is closed and opened again
    // For now, we'll just keep a rolling history of the last 10 messages
    if (inMemoryOverlayHistory.length > 20) {
        inMemoryOverlayHistory.splice(0, inMemoryOverlayHistory.length - 20);
    }

    try {
      let customInstructions = "";
      if (authState.isAuthenticated) {
        try {
          const profile = await getUserService().getUserProfile();
          if (profile) {
            const settings = await getSettingsService().getUserSettings(profile.id);
            if (settings) {
              customInstructions = settings.prompt_instructions || "";
            }
          }
        } catch (settingsErr) {
          console.warn('[Overlay] Failed to fetch custom instructions:', settingsErr);
        }
      }

      // Append user memory context (guarded by toggle, non-blocking, silent failure)
      if (authState.isAuthenticated) {
        try {
          const analyzer = getMemoryAnalyzer(pythonClient, appWindowManager);
          const memEnabled = await analyzer.isMemoryEnabled();
          if (memEnabled) {
            const memCtx = await getMemoryService().buildMemoryContext();
            if (memCtx) customInstructions = customInstructions ? `${customInstructions}\n\n${memCtx}` : memCtx;
          }
        } catch { /* non-critical */ }
      }

      // ── Build history context ──────────────────────────────────────
      // Priority: if a chatId is attached, use that chat's real messages
      // as context (up to last 8). Otherwise fall back to in-memory overlay
      // session history.
      let historyContext: Array<{role: string; content: string}> | null = null;

      if (data.chatId) {
        try {
          const chatMessages = await getChatService().getMessages(data.chatId);
          // Take last 8 messages, exclude any that were already sent in this
          // overlay session to avoid duplication.
          const recent = chatMessages.slice(-8);
          historyContext = recent.map((m: any) => ({ role: m.role, content: m.content }));
          console.log(`[Overlay] Using chat context from chatId=${data.chatId} (${historyContext.length} msgs)`);
        } catch (ctxErr) {
          console.warn('[Overlay] Failed to load chat context, falling back to session history:', ctxErr);
          historyContext = inMemoryOverlayHistory.length > 0 ? [...inMemoryOverlayHistory] : null;
        }
      } else {
        historyContext = inMemoryOverlayHistory.length > 0 ? [...inMemoryOverlayHistory] : null;
      }

      // Add the user's new message to in-memory history (used when no chatId)
      inMemoryOverlayHistory.push({ role: 'user', content: data.text });

      const { text: optimizedText, models: modelsUsed } = await pythonClient.optimizeStream(
        data.text,
        !!data.isRegenerate,
        historyContext,
        (chunk: string, accumulated: string) => {
          overlayManager.send('overlay:optimization-chunk', { chunk, accumulated });
        },
        data.mode || 'fast',
        customInstructions,
        data.attachedFiles || [],
        data.forcedSkill || null,
        data.previousOutput || null
      );

      // Add the assistant's response to history
      inMemoryOverlayHistory.push({ role: 'assistant', content: optimizedText });

      // Invalidate rate-limit cache so the next check reflects the new message
      if (authState.currentUserId) {
        getRateLimitService().invalidateCache(authState.currentUserId);
      }

      Sentry.addBreadcrumb({ category: 'overlay', message: 'Optimization complete', level: 'info' });
      overlayManager.send('overlay:optimization-complete', {
        original: data.text,
        optimized: optimizedText,
      });

        // Save to DB (fire-and-forget, non-blocking)
      if (authState.isAuthenticated) {
        // 1. Save optimization record
        let optimizationId: string | undefined;
        getOptimizationService().saveOptimization(
          data.text,
          optimizedText,
          'overlay',
          { ...buildModelMeta(modelsUsed), source_context: { app: 'overlay' } }
        ).then(opt => { optimizationId = opt.id; })
        .catch((err: Error) => {
          errorLog.append('[Overlay] optimization record save', err);
        });

        // 1b. Trigger background memory analysis (fire-and-forget, non-critical)
        if (authState.currentUserId) {
          const analyzer = getMemoryAnalyzer(pythonClient, appWindowManager);
          analyzer.onNewOptimization(
            authState.currentUserId,
            data.text,
            optimizedText,
            data.forcedSkill || null,
          ).catch((e: unknown) =>
            console.warn('[Overlay] Memory analyzer error (non-critical):', e)
          );
        }

        // 2. Persist messages to DB
        // ── KEY RULE ──────────────────────────────────────────────────
        // If the overlay has a chatId context attached → save into THAT
        // existing chat. Never create a new chat in that case.
        // If no chatId → use/create the overlay session chat as before.
        // ──────────────────────────────────────────────────────────────
        (async () => {
          try {
            const svc = getChatService();
            const targetChatId = data.chatId || null;

            if (targetChatId) {
              // ── Context chat path: append into the selected chat ──
              console.log('[Overlay] Appending to existing chat:', targetChatId);

              const userGroupId = data.userGroupId || crypto.randomUUID();
              const userVersionIndex = data.userVersionIndex ?? 0;
              const assistantGroupId = data.assistantGroupId || crypto.randomUUID();
              const assistantVersionIndex = data.assistantVersionIndex ?? 0;

              // For regenerations we only save the assistant message (user already exists)
              let userMsg: any = null;
              if (!data.isRegenerate) {
                // Pre-generate ID so files can use it as storage path prefix,
                // then do a single INSERT with all metadata — no PATCH needed.
                const preId = crypto.randomUUID();
                let filesForDb: any[] = [];
                if (data.attachedFiles && data.attachedFiles.length > 0 && authState.currentUserId) {
                  const results = await Promise.allSettled(
                    data.attachedFiles.map(f =>
                      uploadAttachment(f, authState.currentUserId!, targetChatId, preId)
                    )
                  );
                  filesForDb = results.map((r, i) => {
                    if (r.status === 'fulfilled') return r.value;
                    console.error(`[Overlay] Upload failed for "${data.attachedFiles![i].name}":`, (r as PromiseRejectedResult).reason?.message);
                    return { name: data.attachedFiles![i].name, mimeType: data.attachedFiles![i].mimeType, sizeBytes: data.attachedFiles![i].sizeBytes, uploadFailed: true };
                  });
                }
                userMsg = await svc.addMessage(targetChatId, data.text, 'user', undefined, {
                  groupId: userGroupId,
                  versionIndex: userVersionIndex,
                  attachedFiles: filesForDb.length > 0 ? filesForDb : undefined,
                  selectedSkill: data.forcedSkill || undefined,
                }, preId);
              }
              const assistantMsg = await svc.addMessage(
                targetChatId,
                optimizedText,
                'assistant',
                optimizationId,
                { ...buildModelMeta(modelsUsed), optimized: true, source_app: 'overlay', groupId: assistantGroupId, versionIndex: assistantVersionIndex }
              );

              // Update cache
              if (authState.currentUserId) {
                const userId = authState.currentUserId;
                const msgs = await svc.getMessages(targetChatId);
                localCache.setMessages(userId, targetChatId, msgs as any);

                // ── Real-time push: send only the new messages so the
                // app window can append them instantly without a full reload.
                const appendMessages: any[] = [];
                if (userMsg) {
                  appendMessages.push({ ...userMsg, groupId: userGroupId, versionIndex: userVersionIndex });
                }
                appendMessages.push({ ...assistantMsg, groupId: assistantGroupId, versionIndex: assistantVersionIndex });
                appWindowManager.send('overlay:messages-appended', {
                  chatId: targetChatId,
                  messages: appendMessages,
                });

                // ── Bump updated_at so this chat rises to the top of the
                // sidebar recents list, then push a fresh chats-loaded event.
                try {
                  await svc.touchChat(targetChatId);
                  const chats = await svc.getChats();
                  localCache.setChats(userId, chats as any);
                  appWindowManager.send('chats-loaded', { chats });
                } catch (touchErr) {
                  console.warn('[Overlay] Failed to touch chat updated_at:', touchErr);
                }
              }

              console.log('[Overlay] Saved messages to context chat:', targetChatId);
            } else {
              // ── No-context path: use/create the overlay session chat ──
              if (!currentOverlayChatId) {
                // Use first 4 words as a placeholder while smart title generates
                const words = data.text.trim().split(/\s+/).slice(0, 4);
                const placeholderTitle = words.join(' ') || 'Overlay Optimization';
                const chat = await svc.createChat(placeholderTitle);
                currentOverlayChatId = chat.id;
                console.log('[Overlay] Created new chat for overlay session:', currentOverlayChatId);

                // Fire-and-forget: generate a smart AI title in the background
                const titlePrompt = buildTitlePrompt(data.text, data.attachedFiles || []);
                if (titlePrompt) {
                  const chatIdForTitle = currentOverlayChatId;
                  (async () => {
                    try {
                      const smartTitle = await pythonClient.generateTitle(titlePrompt);
                      if (smartTitle && smartTitle !== placeholderTitle) {
                        await svc.updateChatTitle(chatIdForTitle, smartTitle);
                        // Push the rename to the main app sidebar immediately
                        appWindowManager.send('chat-renamed', {
                          chatId: chatIdForTitle,
                          title: smartTitle,
                        });
                        console.log(`[Overlay] Smart title generated: "${smartTitle}"`);
                      }
                    } catch (err) {
                      console.warn('[Overlay] Smart title generation failed (non-critical):', err);
                    }
                  })();
                }
              }

              const olUserGroupId = data.userGroupId || crypto.randomUUID();
              const olUserVersionIndex = data.userVersionIndex ?? 0;
              const olAssistantGroupId = data.assistantGroupId || crypto.randomUUID();
              const olAssistantVersionIndex = data.assistantVersionIndex ?? 0;

              if (!data.isRegenerate) {
                if (data.attachedFiles && data.attachedFiles.length > 0 && authState.currentUserId) {
                  const olPreId = crypto.randomUUID();
                  const olResults = await Promise.allSettled(
                    data.attachedFiles.map(f =>
                      uploadAttachment(f, authState.currentUserId!, currentOverlayChatId!, olPreId)
                    )
                  );
                  const olFilesForDb = olResults.map((r, i) => {
                    if (r.status === 'fulfilled') return r.value;
                    console.error(`[Overlay] Upload failed for "${data.attachedFiles![i].name}":`, (r as PromiseRejectedResult).reason?.message);
                    return { name: data.attachedFiles![i].name, mimeType: data.attachedFiles![i].mimeType, sizeBytes: data.attachedFiles![i].sizeBytes, uploadFailed: true };
                  });
                  await svc.addMessage(currentOverlayChatId, data.text, 'user', undefined, {
                    groupId: olUserGroupId,
                    versionIndex: olUserVersionIndex,
                    attachedFiles: olFilesForDb,
                    selectedSkill: data.forcedSkill || undefined,
                  }, olPreId);
                } else {
                  await svc.addMessage(currentOverlayChatId, data.text, 'user', undefined, {
                    groupId: olUserGroupId,
                    versionIndex: olUserVersionIndex,
                  });
                }
              }
              await svc.addMessage(
                currentOverlayChatId,
                optimizedText,
                'assistant',
                optimizationId,
                { ...buildModelMeta(modelsUsed), optimized: true, source_app: 'overlay', groupId: olAssistantGroupId, versionIndex: olAssistantVersionIndex }
              );

              if (authState.currentUserId) {
                const userId = authState.currentUserId;
                const chats = await svc.getChats();
                localCache.setChats(userId, chats as any);
                appWindowManager.send('chats-loaded', { chats });

                if (currentOverlayChatId) {
                  const msgs = await svc.getMessages(currentOverlayChatId);
                  localCache.setMessages(userId, currentOverlayChatId, msgs as any);
                }
              } else {
                const chats = await svc.getChats();
                appWindowManager.send('chats-loaded', { chats });
              }

              console.log('[Overlay] Saved messages to overlay session chat:', currentOverlayChatId);
            }
          } catch (chatErr) {
            errorLog.append('[Overlay] DB save', chatErr);
          }
        })();
      }
    } catch (error) {
      Sentry.addBreadcrumb({ category: 'overlay', message: 'Optimization error', level: 'error' });
      const message = error instanceof Error ? error.message : 'Optimization failed';
      overlayManager.send('overlay:optimization-error', { error: message });
    }
  });

  // ============================================
  // overlay:save — Save optimized prompt to prompt library
  // ============================================
  ipcMain.handle('overlay:save', async (_event, data: {
    title: string;
    content: string;
    collectionId?: string;
  }) => {
    if (!authState.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    const service = getPromptLibraryService();
    const userId = authState.currentUserId;
    let collectionId = data.collectionId;

    if (!networkMonitor.isOnline) {
      // Offline: store optimistically and queue for sync
      if (!collectionId) {
        // No collection specified — use/create local 'Quick Saves'
        const cached = userId ? localCache.getCollections(userId) : [];
        let qs = cached.find((c: any) => c.name === 'Quick Saves');
        if (!qs) {
          qs = { id: `offline-col-${Date.now()}`, user_id: userId || '', name: 'Quick Saves', icon: '⚡', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          if (userId) localCache.addOrUpdateCollection(userId, qs as any);
          offlineQueue.enqueue('create-collection', { name: 'Quick Saves', icon: '⚡', tempId: qs.id });
        }
        collectionId = (qs as any).id as string;
      }
      const tempPrompt = {
        id: `offline-pmt-${Date.now()}`,
        collection_id: collectionId,
        user_id: userId,
        title: data.title,
        content: data.content,
        metadata: { source: 'overlay', savedAt: new Date().toISOString() },
        is_favorite: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (userId) {
        localCache.addOrUpdatePrompt(userId, tempPrompt as any);
        // Immediately notify the app window so the library reflects the new prompt
        const allCollections = localCache.getCollections(userId);
        const allPrompts = localCache.getPrompts(userId);
        appWindowManager.send('prompt-library:loaded', { collections: allCollections, prompts: allPrompts });
      }
      offlineQueue.enqueue('save-prompt', { collectionId, title: data.title, content: data.content, metadata: { source: 'overlay' }, tempId: tempPrompt.id });
      console.warn('[Overlay] Offline — queued save-prompt:', tempPrompt.id);
      return { promptId: tempPrompt.id, collectionId };
    }

    // Online path (original logic)
    // Auto-create "Quick Saves" collection if none specified
    if (!collectionId) {
      const collections = await service.getCollections();
      let quickSaves = collections.find((c: { name: string }) => c.name === 'Quick Saves');
      if (!quickSaves) {
        quickSaves = await service.createCollection('Quick Saves', '⚡');
      }
      collectionId = quickSaves.id;
    }

    const saved = await service.savePrompt(collectionId, data.title, data.content, {
      source: 'overlay',
      savedAt: new Date().toISOString(),
    });
    if (userId) localCache.addOrUpdatePrompt(userId, saved as any);

    // Notify the app window so its prompt library refreshes in real-time
    service.getFullLibrary()
      .then(library => appWindowManager.send('prompt-library:loaded', library))
      .catch(err => console.error('[Overlay] Failed to refresh prompt library in app:', err));

    return { promptId: saved.id, collectionId };
  });

  // ============================================
  // overlay:copy — Copy text to clipboard
  // ============================================
  ipcMain.on('overlay:copy', (_event, data: { text: string }) => {
    if (data?.text) {
      clipboard.writeText(data.text);
    }
  });

  // ============================================
  // overlay:close — Hide the overlay
  // ============================================
  ipcMain.on('overlay:close', () => {
    overlayManager.close();
  });

  // ============================================
  // overlay:open-app — Show the main app window (for login)
  // ============================================
  ipcMain.on('overlay:open-app', () => {
    appWindowManager.show();
  });

  // ============================================
  // overlay:check-auth — Check current auth state
  // ============================================
  ipcMain.handle('overlay:check-auth', async () => {
    return { isAuthenticated: authState.isAuthenticated };
  });

  // ============================================
  // overlay:get-settings — Get current user settings for overlay styling
  // ============================================
  ipcMain.handle('overlay:get-settings', async () => {
    if (!authState.isAuthenticated || !authState.currentUserId) {
      return { theme: 'dark', font_size: 'medium', font_family: 'inter', prompt_instructions: '' };
    }
    try {
      const { SettingsService } = require('../database/services/settings-service');
      const svc = new SettingsService();
      const settings = await svc.getOrCreateSettings(authState.currentUserId);
      // Cache settings in localCache for offline use
      localCache.setSettings(authState.currentUserId, settings);
      return settings;
    } catch (err) {
      // Offline fallback — return cached settings or defaults
      const cached = localCache.getSettings(authState.currentUserId);
      if (cached) {
        console.warn('[Overlay] Offline — returning cached settings');
        return cached;
      }
      return { theme: 'dark', font_size: 'medium', font_family: 'inter', prompt_instructions: '' };
    }
  });

  // ============================================
  // overlay:get-collections — Get collections for save picker
  // ============================================
  ipcMain.handle('overlay:get-collections', async () => {
    const userId = authState.currentUserId;
    try {
      if (!authState.isAuthenticated) throw new Error('Not authenticated');
      const collections = await getPromptLibraryService().getCollections();
      // Keep cache fresh while online
      if (userId) localCache.setCollections(userId, collections as any);
      return collections;
    } catch (err: any) {
      // Offline fallback — return cached collections so the save modal works
      if (userId && !networkMonitor.isOnline) {
        const cached = localCache.getCollections(userId);
        console.warn('[Overlay] Offline — returning', cached.length, 'cached collections');
        return cached;
      }
      throw err;
    }
  });

  // ============================================
  // overlay:create-collection — Create a new collection from the overlay
  // ============================================
  ipcMain.handle('overlay:create-collection', async (_event, data: { name: string; icon?: string }) => {
    const userId = authState.currentUserId;
    if (!authState.isAuthenticated) throw new Error('Not authenticated');

    if (!networkMonitor.isOnline) {
      const tempCol = {
        id: `offline-col-${Date.now()}`,
        user_id: userId,
        name: data.name,
        icon: data.icon || '📁',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (userId) localCache.addOrUpdateCollection(userId, tempCol as any);
      offlineQueue.enqueue('create-collection', { name: data.name, icon: data.icon || '📁', tempId: tempCol.id });
      console.warn('[Overlay] Offline — queued create-collection:', tempCol.id);
      return tempCol;
    }

    const col = await getPromptLibraryService().createCollection(data.name, data.icon || '📁');
    if (userId) localCache.addOrUpdateCollection(userId, col as any);
    return col;
  });

  // ============================================
  // overlay:insert — Close overlay, inject text into original window
  // ============================================
  //
  // Called by the renderer when the user confirms the optimized text.
  // Flow:
  //   1. Close the overlay immediately (so it doesn't interfere with focus).
  //   2. Call replaceAtLastAnchor(text) → Rust takes over:
  //        SetForegroundWindow(anchor.hwnd)
  //        Shift+Left × trigger_len   (selects "@prompt")
  //        KEYEVENTF_UNICODE injection (types replacement text)
  //   3. Returns { success: boolean } to renderer.
  //
  // Fallback: if native bridge is unavailable, write to clipboard instead.
  ipcMain.handle('overlay:insert', (_event, data: { text: string }) => {
    Sentry.addBreadcrumb({ category: 'overlay', message: 'Replace triggered', level: 'info' });
    if (!data?.text) {
      return { success: false, error: 'No text provided' };
    }

    overlayManager.close();

    if (isNativeBridgeAvailable()) {
      const success = replaceAtLastAnchor(data.text);
      if (!success) {
        console.warn('[Overlay] replaceAtLastAnchor failed — window may have lost focus or been closed');
        Sentry.captureMessage('Replace failed', 'warning');
      }
      return { success };
    }

    clipboard.writeText(data.text);
    console.warn('[Overlay] Native bridge unavailable — text copied to clipboard instead');
    return { success: false, fallback: 'clipboard' };
  });

  // ============================================
  // overlay:get-chats — List user's chats for context picker
  // ============================================
  ipcMain.handle('overlay:get-chats', async () => {
    if (!authState.isAuthenticated) throw new Error('Not authenticated');
    try {
      const chats = await getChatService().getChats();
      // Return lightweight list: id + title only
      return chats.map((c: any) => ({ id: c.id, title: c.title }));
    } catch (err: any) {
      const userId = authState.currentUserId;
      if (userId && !networkMonitor.isOnline) {
        const cached = localCache.getChats(userId);
        return (cached as any[]).map((c: any) => ({ id: c.id, title: c.title }));
      }
      throw err;
    }
  });

  // ============================================
  // overlay:save-to-chat — Append optimized prompt as a message into a chat
  // ============================================
  ipcMain.handle('overlay:save-to-chat', async (_event, data: {
    chatId: string;
    content: string;
  }) => {
    if (!authState.isAuthenticated) throw new Error('Not authenticated');
    if (!data?.chatId || !data?.content) throw new Error('chatId and content are required');

    const svc = getChatService();
    const msg = await svc.addMessage(
      data.chatId,
      data.content,
      'assistant',
      undefined,
      { model: 'unknown', optimized: true, source_app: 'overlay', message_type: 'optimized_prompt' }
    );

    console.log('[Overlay] Saved optimized prompt to chat:', data.chatId, 'msgId:', msg.id);

    // Notify the app window to reload messages for this chat
    const userId = authState.currentUserId;
    if (userId) {
      const msgs = await svc.getMessages(data.chatId);
      localCache.setMessages(userId, data.chatId, msgs as any);
      appWindowManager.send('messages-loaded', { chatId: data.chatId, messages: msgs });
    }

    return { messageId: msg.id };
  });

  // ============================================
  // overlay:new-session — Clear conversation history for a fresh session
  // ============================================
  ipcMain.on('overlay:new-session', () => {
    clearOverlayHistory();
  });

  // ============================================
  // overlay:truncate-history — Remove messages after a given index.
  // Called by the overlay frontend on edit/retry so the backend history
  // stays in sync with what the user sees on screen.
  // ============================================
  ipcMain.on('overlay:truncate-history', (_event, data: { keepCount: number }) => {
    const keep = Math.max(0, data.keepCount);
    if (keep < inMemoryOverlayHistory.length) {
      inMemoryOverlayHistory.splice(keep);
      console.log(`[OverlayHandlers] Truncated history to ${keep} messages (had ${keep + (inMemoryOverlayHistory.length - keep)})`);
    }
  });

  // ============================================
  // overlay:stop-generation — Abort the current streaming optimization
  // ============================================
  ipcMain.on('overlay:stop-generation', () => {
    console.log('[Overlay] Stop generation requested');
    pythonClient.abortLatestStream();
  });

  console.log('[OverlayHandlers] IPC handlers registered');
}

import { ipcMain, clipboard, screen } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { logger } from '@sentry/core';
import * as crypto from 'crypto';
import { OverlayWindowManager } from '../overlay/overlay-window-manager';
import { PythonClient, ModelsUsed, ClarifyResult } from '../api/python-client';
import { AppWindowManager } from '../windows/app-window-manager';
import { PromptLibraryService } from '../database/services/prompt-library-service';
import { OptimizationService } from '../database/services/optimization-service';
import { ChatService } from '../database/services/chat-service';
import { authState } from '../utils/auth-state';
import { replaceAtLastAnchor, isNativeBridgeAvailable, pasteTextToWindow, forceFocusWindow, getActiveWindowTitle } from '../utils/native-bridge';
import { detectWindowMode } from '../utils/window-detector';
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
import { analyticsService } from '../analytics/analytics-service';
import { getActiveProjectId, getActiveProjectBranch } from './project-handlers';
import { isWeakMessage } from './chat-handlers';

function humanizeLlmError(err: unknown): string {
    const raw: string = ((err as any)?.message ?? (err as any)?.code ?? String(err)).toLowerCase();
    if (raw.includes('econnrefused') || raw.includes('econnreset') || raw.includes('enotfound')) {
        return 'The AI service is not reachable. Please restart the application and try again.';
    }
    if (raw.includes('etimedout') || raw.includes('timeout')) {
        return 'The AI service timed out. It may be overloaded — please try again in a moment.';
    }
    if (raw.includes('socket hang up') || raw.includes('epipe')) {
        return 'The connection to the AI service was lost mid-response. Please try again.';
    }
    return 'The AI service encountered an error. Please try again.';
}

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
//   overlay:optimize              — Start prompt optimization (streaming)
//   overlay:submit-clarification  — Submit clarification answers (resumes paused optimization)
//   overlay:save                  — Save optimized prompt to library (invoke, returns result)
//   overlay:copy                  — Copy text to clipboard
//   overlay:close                 — Hide the overlay
//   overlay:open-app              — Show the main app window (e.g. for login)
//   overlay:check-auth            — Check current auth state (invoke, returns boolean)
//   overlay:get-collections       — Get prompt library collections (invoke)
//
// Main → Renderer (send):
//   overlay:opened                — Overlay was opened (includes auth state)
//   overlay:auth-state            — Auth state update
//   overlay:clarification-required — Clarification questions for the user
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
// Track the placeholder title so we know whether to attempt a title upgrade later
let currentOverlayChatTitle: string | null = null;

// Pending overlay clarification — only one can be active at a time
interface PendingOverlayOptimization {
  data: {
    text: string;
    isRegenerate?: boolean;
    mode?: string;
    chatId?: string;
    attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>;
    forcedSkill?: string;
    previousOutput?: string;
    userGroupId?: string;
    userVersionIndex?: number;
    assistantGroupId?: string;
    assistantVersionIndex?: number;
    // Carried through the clarification round-trip so the resume
    // path can apply the same project-isolation rule (skip the
    // server-side retrieval) as the direct path.
    spaceMode?: boolean;
    spaceId?: string;
  };
  customInstructions: string;
  historyContext: Array<{ role: string; content: string }> | null;
}
let pendingOverlayClarification: PendingOverlayOptimization | null = null;

function formatOverlayClarificationAnswers(answers: Record<string, string>): string {
  return Object.entries(answers)
    .filter(([, v]) => v && v.trim())
    .map(([key, val]) => `- ${key}: ${val}`)
    .join('\n');
}

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

// Source window info — persisted at @prompt trigger time for multi-section insert
let sourceHwnd: number | null = null;
let sourceWindowTitle: string = '';
let firstSectionDone = false;

/** Store the source window HWND and title from the @prompt trigger. */
export function setSourceWindow(hwnd: number, title: string) {
  sourceHwnd = hwnd;
  sourceWindowTitle = title;
  firstSectionDone = false;
  Sentry.addBreadcrumb({ category: 'overlay.source', message: 'Source window captured', level: 'info', data: { hwnd, title } });
  logger.info(logger.fmt`overlay.source_window_stored hwnd=${hwnd} title=${title}`);
}

/** Clear overlay conversation history and reset chat session (called on "New Session" or sign-out). */
export function clearOverlayHistory() {
  inMemoryOverlayHistory.length = 0;
  currentOverlayChatId = null;
  currentOverlayChatTitle = null;
  sourceHwnd = null;
  sourceWindowTitle = '';
  firstSectionDone = false;
  Sentry.addBreadcrumb({ category: 'overlay.session', message: 'Overlay session cleared', level: 'info' });
  logger.info('overlay.session_cleared');
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
  ipcMain.on('overlay:optimize', async (_event, data: { text: string; isRegenerate?: boolean; mode?: string; chatId?: string; attachedFiles?: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }>; forcedSkill?: string; userGroupId?: string; userVersionIndex?: number; assistantGroupId?: string; assistantVersionIndex?: number; previousOutput?: string; clarificationAnswers?: string; wantsSections?: boolean; clarificationChoices?: { questions: any[]; answers: Record<string, string>; mode: string }; spaceMode?: boolean; spaceId?: string }) => {
    Sentry.addBreadcrumb({ category: 'overlay', message: 'Optimize requested', level: 'info', data: { mode: data.mode, skill: data.forcedSkill, isRegenerate: data.isRegenerate } });
    logger.info(logger.fmt`overlay.optimize_requested mode=${data.mode ?? 'thinking'} skill=${data.forcedSkill ?? 'none'} isRegenerate=${String(!!data.isRegenerate)}`);
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
        logger.warn('overlay.rate_limit_check_failed — allowing through');
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
          Sentry.captureException(settingsErr, { tags: { component: 'overlay-ipc', op: 'fetch-custom-instructions' } });
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
        } catch (memErr) {
          Sentry.captureException(memErr, { tags: { component: 'overlay-ipc', op: 'build-memory-context' } });
        }
      }

      // ── Build history context ──────────────────────────────────────
      // Priority order:
      //   1. spaceMode — the renderer has already done codebase retrieval
      //      and embedded the relevant code chunks directly into `text`.
      //      Mixing in unrelated chat history at this point would dilute
      //      that signal, so we deliberately send NO history. This matches
      //      how SpaceWorkspace routes through `app:optimize-prompt` with
      //      `source: 'space'` and no chatId.
      //   2. chatId attached — pull last 8 messages from that chat.
      //   3. Fallback — rolling in-memory overlay session history.
      let historyContext: Array<{role: string; content: string}> | null = null;

      if (data.spaceMode) {
        historyContext = null;
        console.log(`[Overlay] spaceMode=true (spaceId=${data.spaceId ?? 'none'}) — skipping chat history`);
      } else if (data.chatId) {
        try {
          const chatMessages = await getChatService().getMessages(data.chatId);
          // Take last 8 messages, exclude any that were already sent in this
          // overlay session to avoid duplication.
          const recent = chatMessages.slice(-8);
          historyContext = recent.map((m: any) => ({ role: m.role, content: m.content }));
          console.log(`[Overlay] Using chat context from chatId=${data.chatId} (${historyContext.length} msgs)`);
        } catch (ctxErr) {
          Sentry.captureException(ctxErr, { tags: { component: 'overlay-ipc', op: 'load-chat-context' } });
          console.warn('[Overlay] Failed to load chat context, falling back to session history:', ctxErr);
          historyContext = inMemoryOverlayHistory.length > 0 ? [...inMemoryOverlayHistory] : null;
        }
      } else {
        historyContext = inMemoryOverlayHistory.length > 0 ? [...inMemoryOverlayHistory] : null;
      }

      // Add the user's new message to in-memory history (used when no chatId).
      // Skip in spaceMode so codebase-context turns don't leak into a later
      // "no space attached" optimization session.
      if (!data.spaceMode) {
        inMemoryOverlayHistory.push({ role: 'user', content: data.text });
      }

      // ── Clarification check (skip regenerations, weak messages, and
      // spaceMode where the prompt is already context-loaded) ───────────
      if (!data.isRegenerate && !data.spaceMode && !isWeakMessage(data.text)) {
        try {
          const clarifyResult = await pythonClient.clarify(data.text);
          console.log(`[Overlay] Clarify result: should_clarify=${clarifyResult.should_clarify}, questions=${clarifyResult.questions.length}`);
          if (clarifyResult.should_clarify && clarifyResult.questions.length > 0) {
            pendingOverlayClarification = {
              data,
              customInstructions,
              historyContext,
            };
            overlayManager.send('overlay:clarification-required', clarifyResult);
            return;
          }
        } catch (clarifyErr) {
          console.warn('[Overlay] Clarify call failed (proceeding to optimize):', clarifyErr);
        }
      }

      const { text: optimizedText, models: modelsUsed } = await pythonClient.optimizeStream(
        data.text,
        !!data.isRegenerate,
        historyContext,
        (chunk: string, accumulated: string) => {
          overlayManager.send('overlay:optimization-chunk', { chunk, accumulated });
        },
        data.mode || 'thinking',
        customInstructions,
        data.attachedFiles || [],
        data.forcedSkill || null,
        data.previousOutput || null,
        data.clarificationAnswers || null,
        data.wantsSections,
        // Space mode: the overlay renderer (App.tsx → buildSpacePrompt)
        // has already run retrieval against the *attached* space's
        // project_id(s) and embedded the resulting chunks into
        // `data.text` via buildTailoredPrompt. Passing the global
        // `getActiveProjectId()` here would trigger a SECOND retrieval
        // inside the Python optimizer against whichever folder was
        // last "active" globally — which is often a different space's
        // folder, leaking its code into the prompt. Skip the
        // server-side retrieval entirely in space mode.
        data.spaceMode ? null : getActiveProjectId(),
        data.spaceMode ? null : getActiveProjectBranch(),
      );

      // Add the assistant's response to history (skip in spaceMode for
      // the same isolation reason as the user-side push above).
      if (!data.spaceMode) {
        inMemoryOverlayHistory.push({ role: 'assistant', content: optimizedText });
      }

      // Invalidate rate-limit cache so the next check reflects the new message
      if (authState.currentUserId) {
        getRateLimitService().invalidateCache(authState.currentUserId);
      }

      Sentry.addBreadcrumb({ category: 'overlay', message: 'Optimization complete', level: 'info' });
      logger.info('overlay.optimize_complete');
      overlayManager.send('overlay:optimization-complete', {
        original: data.text,
        optimized: optimizedText,
      });

      analyticsService.logEvent('overlay_optimization', { source: 'overlay' });

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
          Sentry.captureException(err, { tags: { component: 'overlay-handlers', op: 'save-optimization' } });
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
        // ── EXCEPTION: spaceMode ─────────────────────────────────────
        // When the user has attached a Space, the renderer routes the
        // turn into `space.messages` via the spaces bridge instead. We
        // skip the Supabase chat save here so a Space-scoped overlay
        // session doesn't pollute the user's chat sidebar with an
        // auto-generated session chat that holds the same text twice.
        // ──────────────────────────────────────────────────────────────
        if (!data.spaceMode) (async () => {
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
                      uploadAttachment(f, authState.currentUserId!, targetChatId, preId, pythonClient)
                    )
                  );
                  filesForDb = results.map((r, i) => {
                    if (r.status === 'fulfilled') return r.value;
                    const reason = (r as PromiseRejectedResult).reason;
                    console.error(`[Overlay] Upload failed for "${data.attachedFiles![i].name}":`, reason?.message);
                    Sentry.captureException(reason, { tags: { component: 'file-upload', context: 'overlay-context-chat' }, extra: { fileName: data.attachedFiles![i].name, mimeType: data.attachedFiles![i].mimeType } });
                    return { name: data.attachedFiles![i].name, mimeType: data.attachedFiles![i].mimeType, sizeBytes: data.attachedFiles![i].sizeBytes, uploadFailed: true };
                  });
                  const failedNames = filesForDb.filter((f: any) => f.uploadFailed).map((f: any) => f.name);
                  if (failedNames.length > 0) {
                    overlayManager.send('overlay:upload-partial-failure', { failedFiles: failedNames });
                  }
                }
                userMsg = await svc.addMessage(targetChatId, data.text, 'user', undefined, {
                  groupId: userGroupId,
                  versionIndex: userVersionIndex,
                  attachedFiles: filesForDb.length > 0 ? filesForDb : undefined,
                  selectedSkill: data.forcedSkill || undefined,
                }, preId);
              }
              const optAssistMeta: Record<string, any> = {
                ...buildModelMeta(modelsUsed), optimized: true, source_app: 'overlay', groupId: assistantGroupId, versionIndex: assistantVersionIndex,
              };
              if (data.clarificationChoices) optAssistMeta.clarificationChoices = data.clarificationChoices;
              const assistantMsg = await svc.addMessage(
                targetChatId,
                optimizedText,
                'assistant',
                optimizationId,
                optAssistMeta
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
                  Sentry.captureException(touchErr, { tags: { component: 'overlay-ipc', op: 'touch-chat' } });
                  console.warn('[Overlay] Failed to touch chat updated_at:', touchErr);
                }
              }

              console.log('[Overlay] Saved messages to context chat:', targetChatId);
            } else {
              // ── No-context path: use/create the overlay session chat ──
              if (!currentOverlayChatId) {
                const placeholderTitle = data.text.trim().split(/\s+/).slice(0, 4).join(' ') || 'Overlay Optimization';
                const chat = await svc.createChat(placeholderTitle);
                currentOverlayChatId = chat.id;
                console.log('[Overlay] Created new chat for overlay session:', currentOverlayChatId);
              }

              // Fire-and-forget: update title for each of the first 3 messages
              // using the accumulated conversation for the best context.
              const olChatIdForTitle = currentOverlayChatId;
              (async () => {
                try {
                  const prevUserMsgs = inMemoryOverlayHistory.filter(m => m.role === 'user');
                  if (prevUserMsgs.length < 3) {
                    const combinedContent = [
                      ...prevUserMsgs.map(m => m.content),
                      data.text,
                    ].filter(s => s.trim()).join('\n').slice(0, 300);

                    if (combinedContent.trim()) {
                      const smartTitle = await pythonClient.generateTitle(combinedContent);
                      if (smartTitle && smartTitle !== 'New Chat') {
                        await svc.updateChatTitle(olChatIdForTitle!, smartTitle);
                        appWindowManager.send('chat-renamed', { chatId: olChatIdForTitle!, title: smartTitle });
                        console.log(`[Overlay] Title updated (msg ${prevUserMsgs.length + 1}/3): "${smartTitle}"`);
                      }
                    }
                  }
                } catch (err) {
                  Sentry.captureException(err, { tags: { component: 'overlay-ipc', op: 'smart-title-generation' } });
                  console.warn('[Overlay] Title generation failed (non-critical):', err);
                }
              })();

              const olUserGroupId = data.userGroupId || crypto.randomUUID();
              const olUserVersionIndex = data.userVersionIndex ?? 0;
              const olAssistantGroupId = data.assistantGroupId || crypto.randomUUID();
              const olAssistantVersionIndex = data.assistantVersionIndex ?? 0;

              if (!data.isRegenerate) {
                if (data.attachedFiles && data.attachedFiles.length > 0 && authState.currentUserId) {
                  const olPreId = crypto.randomUUID();
                  const olResults = await Promise.allSettled(
                    data.attachedFiles.map(f =>
                      uploadAttachment(f, authState.currentUserId!, currentOverlayChatId!, olPreId, pythonClient)
                    )
                  );
                  const olFilesForDb = olResults.map((r, i) => {
                    if (r.status === 'fulfilled') return r.value;
                    const olReason = (r as PromiseRejectedResult).reason;
                    console.error(`[Overlay] Upload failed for "${data.attachedFiles![i].name}":`, olReason?.message);
                    Sentry.captureException(olReason, { tags: { component: 'file-upload', context: 'overlay-session-chat' }, extra: { fileName: data.attachedFiles![i].name, mimeType: data.attachedFiles![i].mimeType } });
                    return { name: data.attachedFiles![i].name, mimeType: data.attachedFiles![i].mimeType, sizeBytes: data.attachedFiles![i].sizeBytes, uploadFailed: true };
                  });
                  const olFailedNames = olFilesForDb.filter((f: any) => f.uploadFailed).map((f: any) => f.name);
                  if (olFailedNames.length > 0) {
                    overlayManager.send('overlay:upload-partial-failure', { failedFiles: olFailedNames });
                  }
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
              const olOptAssistMeta: Record<string, any> = {
                ...buildModelMeta(modelsUsed), optimized: true, source_app: 'overlay', groupId: olAssistantGroupId, versionIndex: olAssistantVersionIndex,
              };
              if (data.clarificationChoices) olOptAssistMeta.clarificationChoices = data.clarificationChoices;
              await svc.addMessage(
                currentOverlayChatId,
                optimizedText,
                'assistant',
                optimizationId,
                olOptAssistMeta
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
            Sentry.captureException(chatErr, { tags: { component: 'overlay-db-save' } });
          }
        })();
      }
    } catch (error) {
      Sentry.addBreadcrumb({ category: 'overlay', message: 'Optimization error', level: 'error' });
      Sentry.captureException(error);
      const message = humanizeLlmError(error);
      logger.error(logger.fmt`overlay.optimize_error error=${error instanceof Error ? error.message : String(error)}`);
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
      .catch(err => {
        Sentry.captureException(err, { tags: { component: 'overlay-ipc', op: 'refresh-prompt-library' } });
        console.error('[Overlay] Failed to refresh prompt library in app:', err);
      });

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
  ipcMain.handle('overlay:insert', async (_event, data: { text: string }) => {
    return Sentry.startSpan({ name: 'overlay.insert', op: 'ui.replace' }, async (span) => {
      Sentry.addBreadcrumb({ category: 'overlay.replace', message: 'Replace triggered', level: 'info', data: { textLen: data?.text?.length ?? 0, hasSourceHwnd: !!sourceHwnd, firstSectionDone } });
      logger.info(logger.fmt`overlay.replace_triggered textLen=${data?.text?.length ?? 0} sourceHwnd=${sourceHwnd ?? 'null'}`);

      if (!data?.text) {
        span.setStatus({ code: 2, message: 'no_text' });
        return { success: false, error: 'No text provided' };
      }

      overlayManager.close();

      if (!isNativeBridgeAvailable()) {
        Sentry.addBreadcrumb({ category: 'overlay.replace', message: 'Native bridge unavailable', level: 'warning' });
        span.setStatus({ code: 2, message: 'no_native_bridge' });
        return { success: false };
      }

      await new Promise(r => setTimeout(r, 150));

      try {
        let success = replaceAtLastAnchor(data.text);
        Sentry.addBreadcrumb({ category: 'overlay.replace', message: 'replaceAtLastAnchor attempt', level: 'info', data: { success } });

        if (!success && sourceHwnd) {
          Sentry.addBreadcrumb({ category: 'overlay.replace', message: 'Anchor consumed — trying pasteTextToWindow', level: 'info', data: { sourceHwnd } });
          success = pasteTextToWindow(sourceHwnd, data.text);
          Sentry.addBreadcrumb({ category: 'overlay.replace', message: 'pasteTextToWindow result', level: 'info', data: { success } });
        }

        if (success) {
          firstSectionDone = true;
          span.setStatus({ code: 1 });
        } else {
          span.setStatus({ code: 2, message: 'paste_failed' });
          logger.warn('overlay.replace_failed — both anchor and direct paste failed');
        }

        return { success };
      } catch (err) {
        Sentry.captureException(err, { tags: { component: 'overlay-ipc', op: 'insert' }, extra: { sourceHwnd, firstSectionDone } });
        span.setStatus({ code: 2, message: 'exception' });
        logger.error(logger.fmt`overlay.insert_exception error=${err instanceof Error ? err.message : String(err)}`);
        return { success: false, error: String(err) };
      }
    });
  });

  // ============================================
  // overlay:insert-section — Paste a single section without closing overlay
  //
  // First insert: replaceAtLastAnchor (removes @prompt, pastes at exact position)
  // Subsequent:   pasteTextToWindow   (pastes at current cursor in source window)
  //
  // We deliberately do NOT auto-press Enter after the paste, even when the
  // detected window is a chat app. Sending Enter automatically submits the
  // message before the user can review or edit the inserted prompt — which
  // is unwanted for task-style prompts where the user typically wants to
  // tweak the result before sending. Same behavior on Windows and macOS.
  // ============================================
  ipcMain.handle('overlay:insert-section', async (_event, data: { text: string }) => {
    return Sentry.startSpan({ name: 'overlay.insert_section', op: 'ui.section_paste' }, async (span) => {
      Sentry.addBreadcrumb({ category: 'overlay.section', message: 'Section insert triggered', level: 'info', data: { textLen: data?.text?.length ?? 0, firstSectionDone, sourceHwnd: sourceHwnd ?? null } });
      logger.info(logger.fmt`overlay.section_insert_triggered firstSectionDone=${firstSectionDone} sourceHwnd=${sourceHwnd ?? 'null'}`);

      if (!data?.text) {
        span.setStatus({ code: 2, message: 'no_text' });
        return { success: false, error: 'No text provided' };
      }
      if (!sourceHwnd || !isNativeBridgeAvailable()) {
        Sentry.addBreadcrumb({ category: 'overlay.section', message: 'No source window or native bridge', level: 'warning', data: { sourceHwnd: sourceHwnd ?? null, nativeBridge: isNativeBridgeAvailable() } });
        span.setStatus({ code: 2, message: 'no_source' });
        return { success: false };
      }

      const overlayWin = overlayManager.getWindow();
      const detection = detectWindowMode(sourceWindowTitle);
      const isChat = detection.mode === 'chat';
      span.setAttribute('window.mode', detection.mode);
      span.setAttribute('window.app', detection.appName);

      try {
        if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setOpacity(0);
        await new Promise(r => setTimeout(r, 100));

        let success = false;
        let method = '';

        if (!firstSectionDone) {
          success = replaceAtLastAnchor(data.text);
          firstSectionDone = true;
          method = 'replaceAtLastAnchor';
          Sentry.addBreadcrumb({ category: 'overlay.section', message: 'First section via anchor replace', level: 'info', data: { success } });
        }

        if (!success) {
          success = pasteTextToWindow(sourceHwnd, data.text);
          firstSectionDone = true;
          method = method ? `${method}→pasteTextToWindow` : 'pasteTextToWindow';
          Sentry.addBreadcrumb({ category: 'overlay.section', message: 'Section via direct paste', level: 'info', data: { success } });
        }

        span.setAttribute('paste.method', method);

        await new Promise(r => setTimeout(r, 200));
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.setOpacity(1);
          if (process.platform === 'darwin') {
            try {
              overlayWin.focus();
              Sentry.addBreadcrumb({ category: 'overlay-ipc', message: 'macOS overlay focus restored after insert', level: 'info' });
            } catch (focusErr) {
              Sentry.captureException(focusErr, { tags: { component: 'overlay-ipc', op: 'focus-restore-macos' } });
            }
          } else {
            const hwnd = overlayWin.getNativeWindowHandle().readBigInt64LE(0);
            forceFocusWindow(Number(hwnd));
          }
        }

        span.setStatus({ code: success ? 1 : 2, message: success ? undefined : 'paste_failed' });
        if (!success) {
          logger.warn(logger.fmt`overlay.section_insert_failed method=${method}`);
        }
        return { success };
      } catch (err) {
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.setOpacity(1);
          if (process.platform === 'darwin') {
            try {
              overlayWin.focus();
              Sentry.addBreadcrumb({ category: 'overlay-ipc', message: 'macOS overlay focus restored in catch', level: 'info' });
            } catch (focusErr) {
              Sentry.captureException(focusErr, { tags: { component: 'overlay-ipc', op: 'focus-restore-macos-catch' } });
            }
          } else {
            const hwnd = overlayWin.getNativeWindowHandle().readBigInt64LE(0);
            forceFocusWindow(Number(hwnd));
          }
        }
        Sentry.captureException(err, { tags: { component: 'overlay-ipc', op: 'insert-section' }, extra: { sourceHwnd, firstSectionDone, isChat, windowTitle: sourceWindowTitle } });
        span.setStatus({ code: 2, message: 'exception' });
        logger.error(logger.fmt`overlay.section_insert_exception error=${err instanceof Error ? err.message : String(err)}`);
        return { success: false, error: String(err) };
      }
    });
  });

  // ============================================
  // overlay:get-source-info — Return source window metadata
  // ============================================
  ipcMain.handle('overlay:get-source-info', () => {
    if (!sourceHwnd) {
      return { hwnd: null, title: '', detectedMode: 'document' as const, confidence: 'low' as const, appName: 'Unknown' };
    }
    const detection = detectWindowMode(sourceWindowTitle);
    return {
      hwnd: sourceHwnd,
      title: sourceWindowTitle,
      detectedMode: detection.mode,
      confidence: detection.confidence,
      appName: detection.appName,
    };
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

  // ============================================
  // overlay:submit-clarification — Resume optimization with clarification answers
  // ============================================
  ipcMain.on('overlay:submit-clarification', async (_event, submitData: {
    answers: Record<string, string>;
    wantsSections: boolean;
    clarificationChoices?: { questions: any[]; answers: Record<string, string>; mode: string };
  }) => {
    const pending = pendingOverlayClarification;
    if (!pending) {
      console.warn('[Overlay] submit-clarification: no pending optimization');
      return;
    }
    pendingOverlayClarification = null;

    const formattedAnswers = formatOverlayClarificationAnswers(submitData.answers);
    Sentry.addBreadcrumb({ category: 'overlay', message: 'Clarification submitted', level: 'info', data: { wantsSections: submitData.wantsSections } });

    try {
      const { text: optimizedText, models: modelsUsed } = await pythonClient.optimizeStream(
        pending.data.text,
        !!pending.data.isRegenerate,
        pending.historyContext,
        (chunk: string, accumulated: string) => {
          overlayManager.send('overlay:optimization-chunk', { chunk, accumulated });
        },
        pending.data.mode || 'thinking',
        pending.customInstructions,
        pending.data.attachedFiles || [],
        pending.data.forcedSkill || null,
        pending.data.previousOutput || null,
        formattedAnswers || null,
        submitData.wantsSections,
        // Same space-mode isolation as the non-clarification path —
        // see comment at the primary optimizeStream call above.
        pending.data.spaceMode ? null : getActiveProjectId(),
        pending.data.spaceMode ? null : getActiveProjectBranch(),
      );

      inMemoryOverlayHistory.push({ role: 'assistant', content: optimizedText });

      if (authState.currentUserId) {
        getRateLimitService().invalidateCache(authState.currentUserId);
      }

      Sentry.addBreadcrumb({ category: 'overlay', message: 'Clarification optimization complete', level: 'info' });
      overlayManager.send('overlay:optimization-complete', {
        original: pending.data.text,
        optimized: optimizedText,
      });

      analyticsService.logEvent('overlay_optimization', { source: 'overlay', clarified: true });

      // Fire-and-forget DB save — full chat message persistence
      if (authState.isAuthenticated) {
        let optimizationId: string | undefined;
        getOptimizationService().saveOptimization(
          pending.data.text,
          optimizedText,
          'overlay',
          { ...buildModelMeta(modelsUsed), source_context: { app: 'overlay', clarified: true } }
        ).then(opt => { optimizationId = opt.id; })
        .catch((err: Error) => {
          errorLog.append('[Overlay] clarification optimization record save', err);
          Sentry.captureException(err, { tags: { component: 'overlay-handlers', op: 'save-optimization-clarify' } });
        });

        if (authState.currentUserId) {
          const analyzer = getMemoryAnalyzer(pythonClient, appWindowManager);
          analyzer.onNewOptimization(
            authState.currentUserId,
            pending.data.text,
            optimizedText,
            pending.data.forcedSkill || null,
          ).catch((e: unknown) =>
            console.warn('[Overlay] Memory analyzer error (non-critical):', e)
          );
        }

        // Persist messages to DB (same logic as regular overlay:optimize)
        (async () => {
          try {
            const svc = getChatService();
            const targetChatId = pending.data.chatId || null;

            if (targetChatId) {
              console.log('[Overlay/Clarify] Appending to existing chat:', targetChatId);

              const userGroupId = pending.data.userGroupId || crypto.randomUUID();
              const userVersionIndex = pending.data.userVersionIndex ?? 0;
              const assistantGroupId = pending.data.assistantGroupId || crypto.randomUUID();
              const assistantVersionIndex = pending.data.assistantVersionIndex ?? 0;

              let userMsg: any = null;
              if (!pending.data.isRegenerate) {
                const preId = crypto.randomUUID();
                let filesForDb: any[] = [];
                if (pending.data.attachedFiles && pending.data.attachedFiles.length > 0 && authState.currentUserId) {
                  const results = await Promise.allSettled(
                    pending.data.attachedFiles.map(f =>
                      uploadAttachment(f, authState.currentUserId!, targetChatId, preId, pythonClient)
                    )
                  );
                  filesForDb = results.map((r, i) => {
                    if (r.status === 'fulfilled') return r.value;
                    const reason = (r as PromiseRejectedResult).reason;
                    console.error(`[Overlay/Clarify] Upload failed for "${pending.data.attachedFiles![i].name}":`, reason?.message);
                    Sentry.captureException(reason, { tags: { component: 'file-upload', context: 'overlay-clarify-chat' }, extra: { fileName: pending.data.attachedFiles![i].name, mimeType: pending.data.attachedFiles![i].mimeType } });
                    return { name: pending.data.attachedFiles![i].name, mimeType: pending.data.attachedFiles![i].mimeType, sizeBytes: pending.data.attachedFiles![i].sizeBytes, uploadFailed: true };
                  });
                }
                userMsg = await svc.addMessage(targetChatId, pending.data.text, 'user', undefined, {
                  groupId: userGroupId,
                  versionIndex: userVersionIndex,
                  attachedFiles: filesForDb.length > 0 ? filesForDb : undefined,
                  selectedSkill: pending.data.forcedSkill || undefined,
                }, preId);
              }
              const clarifyAssistMeta: Record<string, any> = {
                ...buildModelMeta(modelsUsed), optimized: true, source_app: 'overlay', groupId: assistantGroupId, versionIndex: assistantVersionIndex,
              };
              if (submitData.clarificationChoices) clarifyAssistMeta.clarificationChoices = submitData.clarificationChoices;
              const assistantMsg = await svc.addMessage(
                targetChatId,
                optimizedText,
                'assistant',
                optimizationId,
                clarifyAssistMeta
              );

              if (authState.currentUserId) {
                const userId = authState.currentUserId;
                const msgs = await svc.getMessages(targetChatId);
                localCache.setMessages(userId, targetChatId, msgs as any);
                const appendMessages: any[] = [];
                if (userMsg) appendMessages.push({ ...userMsg, groupId: userGroupId, versionIndex: userVersionIndex });
                appendMessages.push({ ...assistantMsg, groupId: assistantGroupId, versionIndex: assistantVersionIndex });
                appWindowManager.send('overlay:messages-appended', { chatId: targetChatId, messages: appendMessages });

                try {
                  await svc.touchChat(targetChatId);
                  const chats = await svc.getChats();
                  localCache.setChats(userId, chats as any);
                  appWindowManager.send('chats-loaded', { chats });
                } catch (touchErr) {
                  console.warn('[Overlay/Clarify] Failed to touch chat:', touchErr);
                }
              }
              console.log('[Overlay/Clarify] Saved messages to context chat:', targetChatId);
            } else {
              if (!currentOverlayChatId) {
                const placeholderTitle = pending.data.text.trim().split(/\s+/).slice(0, 4).join(' ') || 'Overlay Optimization';
                const chat = await svc.createChat(placeholderTitle);
                currentOverlayChatId = chat.id;
                console.log('[Overlay/Clarify] Created new chat:', currentOverlayChatId);
              }

              // Fire-and-forget: update title for each of the first 3 messages.
              const olClarifyChatIdForTitle = currentOverlayChatId;
              (async () => {
                try {
                  const prevUserMsgs = inMemoryOverlayHistory.filter(m => m.role === 'user');
                  if (prevUserMsgs.length < 3) {
                    const combinedContent = [
                      ...prevUserMsgs.map(m => m.content),
                      pending.data.text,
                    ].filter(s => s.trim()).join('\n').slice(0, 300);

                    if (combinedContent.trim()) {
                      const smartTitle = await pythonClient.generateTitle(combinedContent);
                      if (smartTitle && smartTitle !== 'New Chat') {
                        await svc.updateChatTitle(olClarifyChatIdForTitle!, smartTitle);
                        appWindowManager.send('chat-renamed', { chatId: olClarifyChatIdForTitle!, title: smartTitle });
                        console.log(`[Overlay/Clarify] Title updated (msg ${prevUserMsgs.length + 1}/3): "${smartTitle}"`);
                      }
                    }
                  }
                } catch (err) {
                  console.warn('[Overlay/Clarify] Title generation failed (non-critical):', err);
                }
              })();

              const olUserGroupId = pending.data.userGroupId || crypto.randomUUID();
              const olAssistantGroupId = pending.data.assistantGroupId || crypto.randomUUID();

              if (!pending.data.isRegenerate) {
                await svc.addMessage(currentOverlayChatId, pending.data.text, 'user', undefined, {
                  groupId: olUserGroupId,
                  versionIndex: pending.data.userVersionIndex ?? 0,
                });
              }
              const olClarifyAssistMeta: Record<string, any> = {
                ...buildModelMeta(modelsUsed), optimized: true, source_app: 'overlay', groupId: olAssistantGroupId, versionIndex: pending.data.assistantVersionIndex ?? 0,
              };
              if (submitData.clarificationChoices) olClarifyAssistMeta.clarificationChoices = submitData.clarificationChoices;
              await svc.addMessage(
                currentOverlayChatId,
                optimizedText,
                'assistant',
                optimizationId,
                olClarifyAssistMeta
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
              }
              console.log('[Overlay/Clarify] Saved messages to session chat:', currentOverlayChatId);
            }
          } catch (chatErr) {
            errorLog.append('[Overlay/Clarify] DB save', chatErr);
            Sentry.captureException(chatErr, { tags: { component: 'overlay-clarify-db-save' } });
          }
        })();
      }
    } catch (error) {
      Sentry.captureException(error);
      const message = humanizeLlmError(error);
      overlayManager.send('overlay:optimization-error', { error: message });
    }
  });

  console.log('[OverlayHandlers] IPC handlers registered');
}

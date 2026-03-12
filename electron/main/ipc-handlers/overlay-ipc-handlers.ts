import { ipcMain, clipboard } from 'electron';
import { OverlayWindowManager } from '../overlay/overlay-window-manager';
import { PythonClient } from '../api/python-client';
import { AppWindowManager } from '../windows/app-window-manager';
import { PromptLibraryService } from '../database/services/prompt-library-service';
import { OptimizationService } from '../database/services/optimization-service';
import { ChatService } from '../database/services/chat-service';
import { authState } from '../utils/auth-state';
import { replaceAtLastAnchor, isNativeBridgeAvailable } from '../utils/native-bridge';
import { SettingsService } from '../database/services/settings-service';
import { UserService } from '../database/services/user-service';

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

// Simple in-memory history for the overlay session so the user can refine prompts
const inMemoryOverlayHistory: Array<{role: string, content: string}> = [];

// Track the current overlay session's chat ID so all messages go to the same chat
let currentOverlayChatId: string | null = null;

let chatService: ChatService | null = null;
function getChatService(): ChatService {
  if (!chatService) chatService = new ChatService();
  return chatService;
}

/** Clear overlay conversation history and reset chat session (called on "New Session"). */
function clearOverlayHistory() {
  inMemoryOverlayHistory.length = 0;
  currentOverlayChatId = null;
  console.log('[OverlayHandlers] Overlay session history cleared');
}

export function registerOverlayHandlers(
  overlayManager: OverlayWindowManager,
  pythonClient: PythonClient,
  appWindowManager: AppWindowManager
) {
  // ============================================
  // overlay:optimize — Run prompt optimization with streaming
  // ============================================
  ipcMain.on('overlay:optimize', async (_event, data: { text: string; isRegenerate?: boolean; mode?: string }) => {
    if (!authState.isAuthenticated) {
      overlayManager.send('overlay:optimization-error', { error: 'Not authenticated' });
      return;
    }

    if (!data?.text?.trim()) {
      overlayManager.send('overlay:optimization-error', { error: 'Empty prompt' });
      return;
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

      // We pass the current history before adding the new message
      const historyContext = inMemoryOverlayHistory.length > 0 ? [...inMemoryOverlayHistory] : null;
      
      // Add the user's new message to history
      inMemoryOverlayHistory.push({ role: 'user', content: data.text });

      const optimizedText = await pythonClient.optimizeStream(
        data.text,
        !!data.isRegenerate,
        historyContext,
        (chunk: string, accumulated: string) => {
          overlayManager.send('overlay:optimization-chunk', { chunk, accumulated });
        },
        data.mode || 'fast',
        customInstructions
      );

      // Add the assistant's response to history
      inMemoryOverlayHistory.push({ role: 'assistant', content: optimizedText });

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
          { model: 'llama3.2', source_context: { app: 'overlay' } }
        ).then(opt => { optimizationId = opt.id; })
        .catch((err: Error) => {
          console.error('[Overlay] Failed to save optimization record:', err.message);
        });

        // 2. Persist as a chat so it appears in the app sidebar
        (async () => {
          try {
            const svc = getChatService();

            // Create a new chat on the first message of this session
            if (!currentOverlayChatId) {
              const words = data.text.trim().split(/\s+/).slice(0, 4);
              const title = words.join(' ') || 'Overlay Optimization';
              const chat = await svc.createChat(title);
              currentOverlayChatId = chat.id;
              console.log('[Overlay] Created chat for overlay session:', currentOverlayChatId);
            }

            // Save user message
            await svc.addMessage(currentOverlayChatId, data.text, 'user');

            // Save assistant message
            await svc.addMessage(
              currentOverlayChatId,
              optimizedText,
              'assistant',
              optimizationId,
              { model: 'llama3.2', optimized: true, source_app: 'overlay' }
            );

            // Notify the app window so its sidebar refreshes
            const chats = await svc.getChats();
            appWindowManager.send('chats-loaded', { chats });

            console.log('[Overlay] Saved messages to chat:', currentOverlayChatId);
          } catch (chatErr) {
            console.error('[Overlay] Failed to save overlay chat:', chatErr);
          }
        })();
      }
    } catch (error) {
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
    let collectionId = data.collectionId;

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
      return {
        theme: 'dark',
        font_size: 'medium',
        font_family: 'inter',
        prompt_instructions: '',
      };
    }
    const { SettingsService } = require('../database/services/settings-service');
    const settingsService = new SettingsService();
    return await settingsService.getOrCreateSettings(authState.currentUserId);
  });

  // ============================================
  // overlay:get-collections — Get collections for save picker
  // ============================================
  ipcMain.handle('overlay:get-collections', async () => {
    if (!authState.isAuthenticated) {
      throw new Error('Not authenticated');
    }
    return await getPromptLibraryService().getCollections();
  });

  // ============================================
  // overlay:create-collection — Create a new collection from the overlay
  // ============================================
  ipcMain.handle('overlay:create-collection', async (_event, data: { name: string; icon?: string }) => {
    if (!authState.isAuthenticated) {
      throw new Error('Not authenticated');
    }
    return await getPromptLibraryService().createCollection(data.name, data.icon || '📁');
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
    if (!data?.text) {
      return { success: false, error: 'No text provided' };
    }

    // Close overlay BEFORE calling replaceAtLastAnchor so it doesn't stay on top
    // of the window we are about to inject into.
    overlayManager.close();

    if (isNativeBridgeAvailable()) {
      const success = replaceAtLastAnchor(data.text);
      if (!success) {
        console.warn('[Overlay] replaceAtLastAnchor failed — window may have lost focus or been closed');
      }
      return { success };
    }

    // Fallback for when native module is not built.
    clipboard.writeText(data.text);
    console.warn('[Overlay] Native bridge unavailable — text copied to clipboard instead');
    return { success: false, fallback: 'clipboard' };
  });

  // ============================================
  // overlay:new-session — Clear conversation history for a fresh session
  // ============================================
  ipcMain.on('overlay:new-session', () => {
    clearOverlayHistory();
  });

  console.log('[OverlayHandlers] IPC handlers registered');
}

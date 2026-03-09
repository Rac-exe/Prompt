import { ipcMain, clipboard } from 'electron';
import { OverlayWindowManager } from '../overlay/overlay-window-manager';
import { PythonClient } from '../api/python-client';
import { AppWindowManager } from '../windows/app-window-manager';
import { PromptLibraryService } from '../database/services/prompt-library-service';
import { OptimizationService } from '../database/services/optimization-service';
import { authState } from '../utils/auth-state';
import { replaceAtLastAnchor, isNativeBridgeAvailable } from '../utils/native-bridge';

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

    try {
      const optimizedText = await pythonClient.optimizeStream(
        data.text,
        !!data.isRegenerate,
        null,
        (chunk: string, accumulated: string) => {
          overlayManager.send('overlay:optimization-chunk', { chunk, accumulated });
        },
        data.mode || 'fast'
      );

      overlayManager.send('overlay:optimization-complete', {
        original: data.text,
        optimized: optimizedText,
      });

      // Save optimization record to DB (fire-and-forget, non-blocking)
      if (authState.isAuthenticated) {
        getOptimizationService().saveOptimization(
          data.text,
          optimizedText,
          'overlay',
          { model: 'llama3.2', source_context: { app: 'overlay' } }
        ).catch((err: Error) => {
          console.error('[Overlay] Failed to save optimization record:', err.message);
        });
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

  console.log('[OverlayHandlers] IPC handlers registered');
}

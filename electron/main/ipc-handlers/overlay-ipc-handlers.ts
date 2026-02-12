import { ipcMain, clipboard } from 'electron';
import { OverlayWindowManager } from '../overlay/overlay-window-manager';
import { PythonClient } from '../api/python-client';
import { AppWindowManager } from '../windows/app-window-manager';
import { PromptLibraryService } from '../database/services/prompt-library-service';
import { OptimizationService } from '../database/services/optimization-service';
import { authState } from '../utils/auth-state';

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
  ipcMain.on('overlay:optimize', async (_event, data: { text: string; isRegenerate?: boolean }) => {
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
        }
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

  console.log('[OverlayHandlers] IPC handlers registered');
}

import { ipcMain } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { PromptLibraryService } from '../database/services/prompt-library-service';
import { authState } from '../utils/auth-state';
import { localCache } from '../database/local-cache';
import { offlineQueue } from '../database/offline-queue';
import { networkMonitor } from './network-monitor-singleton';

// ============================================
// PROMPT LIBRARY IPC HANDLERS
// ============================================

let promptLibraryService: PromptLibraryService | null = null;
const getService = () => {
    if (!promptLibraryService) {
        promptLibraryService = new PromptLibraryService();
    }
    return promptLibraryService;
};

// ============================================
// OFFLINE SYNC — called when network reconnects
// ============================================
export async function syncOfflineQueue(appWindowSend?: (channel: string, data: any) => void): Promise<void> {
    const pending = offlineQueue.getAll();
    if (pending.length === 0) return;
    console.log('[OfflineSync] Processing', pending.length, 'queued operations...');

    // Map from temporary offline ID → real server ID, built as we sync create-collection ops
    const tempIdToRealId = new Map<string, string>();

    // --- Pass 1: create-collection and create-collection-and-save ---
    for (const op of pending) {
        if (op.type !== 'create-collection' && op.type !== 'create-collection-and-save') continue;
        try {
            const userId = authState.currentUserId;
            if (!userId) break;

            if (op.type === 'create-collection') {
                const { name, icon } = op.payload;
                const created = await getService().createCollection(name, icon);
                if (userId) {
                    localCache.addOrUpdateCollection(userId, created as any);
                    // Remove the stale offline-col-xxx entry now that the real one is stored
                    if (op.payload.tempId) localCache.removeCollection(userId, op.payload.tempId);
                }
                offlineQueue.remove(op.id);
                // Record temp→real mapping (the payload may have included the temp ID)
                if (op.payload.tempId) tempIdToRealId.set(op.payload.tempId, created.id);
                // Also map by name so save-prompt ops can resolve by name if needed
                tempIdToRealId.set(`name:${name}`, created.id);
                console.log('[OfflineSync] ✅ Synced create-collection:', created.id);
            } else if (op.type === 'create-collection-and-save') {
                const { collectionName, collectionIcon, promptTitle, promptContent, metadata } = op.payload;
                const col = await getService().createCollection(collectionName, collectionIcon);
                const pmt = await getService().savePrompt(col.id, promptTitle, promptContent, metadata);
                if (userId) {
                    localCache.addOrUpdateCollection(userId, col as any);
                    localCache.addOrUpdatePrompt(userId, pmt as any);
                }
                offlineQueue.remove(op.id);
                tempIdToRealId.set(`name:${collectionName}`, col.id);
                console.log('[OfflineSync] ✅ Synced create-collection-and-save');
            }
        } catch (err) {
            Sentry.captureException(err, { tags: { component: 'prompt-library-handlers', op: 'offline-sync-pass1', opType: op.type }, extra: { opId: op.id } });
            console.warn('[OfflineSync] Failed to sync op', op.id, '— will retry:', err);
            offlineQueue.incrementRetry(op.id);
        }
    }

    // --- Pass 2: save-prompt ---
    for (const op of offlineQueue.getAll()) {
        if (op.type !== 'save-prompt') continue;
        try {
            const userId = authState.currentUserId;
            if (!userId) break;

            let { collectionId, title, content, metadata } = op.payload;

            // Resolve offline collection ID → real server ID
            if (collectionId && (collectionId as string).startsWith('offline-col-')) {
                // Case 1: direct map from a create-collection that ran in pass 1
                const resolved = tempIdToRealId.get(collectionId as string);
                if (resolved) {
                    collectionId = resolved;
                } else {
                    // Case 2: try to find by looking at local cache (real collections only)
                    const realCols = localCache.getCollections(userId)
                        .filter((c: any) => !c.id.startsWith('offline-col-'));
                    if (realCols.length > 0) {
                        // Best-effort: pick the most recently created collection
                        collectionId = realCols[0].id;
                        console.warn('[OfflineSync] Could not resolve offline collectionId, using:', collectionId);
                    } else {
                        // Can't resolve — skip for now
                        console.warn('[OfflineSync] Cannot resolve offline collectionId', op.payload.collectionId, '— deferring');
                        offlineQueue.incrementRetry(op.id);
                        continue;
                    }
                }
            }

            const saved = await getService().savePrompt(collectionId, title, content, metadata);
            if (userId) {
                localCache.addOrUpdatePrompt(userId, saved as any);
                // Remove the stale offline-pmt-xxx entry so there's no duplicate in the UI
                if (op.payload.tempId) localCache.removePrompt(userId, op.payload.tempId);
            }
            offlineQueue.remove(op.id);
            console.log('[OfflineSync] ✅ Synced save-prompt:', saved.id);
        } catch (err) {
            Sentry.captureException(err, { tags: { component: 'prompt-library-handlers', op: 'offline-sync-pass2', opType: op.type }, extra: { opId: op.id } });
            console.warn('[OfflineSync] Failed to sync op', op.id, '— will retry:', err);
            offlineQueue.incrementRetry(op.id);
        }
    }

    // Notify the renderer to refresh the prompt library
    if (appWindowSend) {
        try {
            const collections = await getService().getCollections();
            const prompts = await getService().getPrompts();
            const userId = authState.currentUserId;
            if (userId) {
                localCache.setCollections(userId, collections as any);
                localCache.setPrompts(userId, prompts as any);
            }
            appWindowSend('prompt-library:loaded', { collections, prompts });
        } catch (_) { /* best-effort */ }
    }
}


// ============================================
// COLLECTIONS
// ============================================

ipcMain.handle('prompt-library:get-collections', async () => {
    try {
        if (!authState.isAuthenticated) throw new Error('Not authenticated');
        const userId = authState.currentUserId;
        console.log('[IPC] prompt-library:get-collections');
        const collections = await getService().getCollections();

        // Merge any offline-queued collections so they don't disappear before sync
        let merged = [...collections] as any[];
        if (userId) {
            const cachedCols = localCache.getCollections(userId);
            for (const c of cachedCols) {
                if ((c.id as string).startsWith('offline-col-') &&
                    !merged.find((x: any) => x.id === c.id)) {
                    merged = [c, ...merged]; // Prepend optimistic ones
                }
            }
            localCache.setCollections(userId, merged as any);
        }
        console.log('[IPC] ✅ Loaded', merged.length, 'collections (incl. pending offline)');
        return merged;
    } catch (error: any) {
        const userId = authState.currentUserId;
        if (userId && !networkMonitor.isOnline) {
            const cached = localCache.getCollections(userId);
            console.warn('[IPC] Offline — returning', cached.length, 'cached collections');
            return cached;
        }
        Sentry.captureException(error, { tags: { component: 'prompt-library-handlers', op: 'prompt-library:get-collections' } });
        console.error('[IPC] ❌ Error loading collections:', error);
        throw error;
    }
});

ipcMain.handle('prompt-library:get-all', async () => {
    try {
        if (!authState.isAuthenticated) throw new Error('Not authenticated');
        const userId = authState.currentUserId;
        console.log('[IPC] prompt-library:get-all');
        const prompts = await getService().getPrompts();

        // Merge any offline-queued prompts so they don't disappear before sync completes
        let merged = [...prompts] as any[];
        if (userId) {
            const cachedPrompts = localCache.getPrompts(userId);
            for (const p of cachedPrompts) {
                if ((p.id as string).startsWith('offline-pmt-') &&
                    !merged.find((x: any) => x.id === p.id)) {
                    merged = [p, ...merged]; // Prepend optimistic ones
                }
            }
            localCache.setPrompts(userId, merged as any);
        }
        console.log('[IPC] ✅ Loaded', merged.length, 'prompts (incl. pending offline)');
        return merged;
    } catch (error: any) {
        const userId = authState.currentUserId;
        if (userId && !networkMonitor.isOnline) {
            const cached = localCache.getPrompts(userId);
            console.warn('[IPC] Offline — returning', cached.length, 'cached prompts');
            return cached;
        }
        Sentry.captureException(error, { tags: { component: 'prompt-library-handlers', op: 'prompt-library:get-prompts' } });
        console.error('[IPC] ❌ Error loading prompts:', error);
        throw error;
    }
});

ipcMain.handle('prompt-library:create-collection', async (event, { name, icon }) => {
    try {
        if (!authState.isAuthenticated) throw new Error('Not authenticated');
        const userId = authState.currentUserId;
        console.log('[IPC] prompt-library:create-collection:', name);

        if (!networkMonitor.isOnline) {
            // Optimistic: create a temporary local collection
            const tempCollection = {
                id: `offline-col-${Date.now()}`,
                user_id: userId,
                name,
                icon: icon || 'folder',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            if (userId) localCache.addOrUpdateCollection(userId, tempCollection as any);
            offlineQueue.enqueue('create-collection', { name, icon });
            console.warn('[IPC] Offline — queued create-collection (optimistic id:', tempCollection.id, ')');
            return tempCollection;
        }

        const collection = await getService().createCollection(name, icon);
        if (userId) localCache.addOrUpdateCollection(userId, collection as any);
        console.log('[IPC] ✅ Collection created:', collection.id);
        return collection;
    } catch (error: any) {
        Sentry.captureException(error, { tags: { component: 'prompt-library-handlers', op: 'prompt-library:create-collection' } });
        console.error('[IPC] ❌ Error creating collection:', error);
        throw error;
    }
});

ipcMain.handle('prompt-library:rename-collection', async (event, { collectionId, name }) => {
    try {
        if (!authState.isAuthenticated) throw new Error('Not authenticated');
        console.log('[IPC] prompt-library:rename-collection:', collectionId, name);
        const collection = await getService().renameCollection(collectionId, name);
        console.log('[IPC] ✅ Collection renamed');
        return collection;
    } catch (error: any) {
        Sentry.captureException(error, { tags: { component: 'prompt-library-handlers', op: 'prompt-library:rename-collection' } });
        console.error('[IPC] ❌ Error renaming collection:', error);
        throw error;
    }
});

ipcMain.handle('prompt-library:delete-collection', async (event, { collectionId }) => {
    try {
        if (!authState.isAuthenticated) throw new Error('Not authenticated');
        console.log('[IPC] prompt-library:delete-collection:', collectionId);
        await getService().deleteCollection(collectionId);
        console.log('[IPC] ✅ Collection deleted');
        return { success: true };
    } catch (error: any) {
        Sentry.captureException(error, { tags: { component: 'prompt-library-handlers', op: 'prompt-library:delete-collection' } });
        console.error('[IPC] ❌ Error deleting collection:', error);
        throw error;
    }
});

// ============================================
// PROMPTS
// ============================================

ipcMain.handle('prompt-library:save-prompt', async (event, { collectionId, title, content, metadata }) => {
    try {
        const userId = authState.currentUserId;
        console.log('[IPC] prompt-library:save-prompt:', { collectionId, title });

        if (!networkMonitor.isOnline) {
            // Optimistic: store locally and queue for sync
            const tempPrompt = {
                id: `offline-pmt-${Date.now()}`,
                collection_id: collectionId,
                user_id: userId,
                title,
                content,
                metadata: metadata || {},
                is_favorite: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            if (userId) localCache.addOrUpdatePrompt(userId, tempPrompt as any);
            offlineQueue.enqueue('save-prompt', { collectionId, title, content, metadata, tempId: tempPrompt.id });
            console.warn('[IPC] Offline — queued save-prompt (optimistic id:', tempPrompt.id, ')');
            return tempPrompt;
        }

        const prompt = await getService().savePrompt(collectionId, title, content, metadata);
        if (userId) localCache.addOrUpdatePrompt(userId, prompt as any);
        console.log('[IPC] ✅ Prompt saved:', prompt.id);
        return prompt;
    } catch (error: any) {
        Sentry.captureException(error, { tags: { component: 'prompt-library-handlers', op: 'prompt-library:save-prompt' } });
        console.error('[IPC] ❌ Error saving prompt:', error);
        throw error;
    }
});

ipcMain.handle('prompt-library:create-collection-and-save', async (event, { collectionName, collectionIcon, promptTitle, promptContent, metadata }) => {
    try {
        const userId = authState.currentUserId;
        console.log('[IPC] prompt-library:create-collection-and-save:', collectionName, promptTitle);

        if (!networkMonitor.isOnline) {
            const tempCol = {
                id: `offline-col-${Date.now()}`,
                user_id: userId,
                name: collectionName,
                icon: collectionIcon || 'folder',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            const tempPmt = {
                id: `offline-pmt-${Date.now()}`,
                collection_id: tempCol.id,
                user_id: userId,
                title: promptTitle,
                content: promptContent,
                metadata: metadata || {},
                is_favorite: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            if (userId) {
                localCache.addOrUpdateCollection(userId, tempCol as any);
                localCache.addOrUpdatePrompt(userId, tempPmt as any);
            }
            offlineQueue.enqueue('create-collection-and-save', { collectionName, collectionIcon, promptTitle, promptContent, metadata });
            console.warn('[IPC] Offline — queued create-collection-and-save');
            return { collection: tempCol, prompt: tempPmt };
        }

        const collection = await getService().createCollection(collectionName, collectionIcon);
        const prompt = await getService().savePrompt(collection.id, promptTitle, promptContent, metadata);
        if (userId) {
            localCache.addOrUpdateCollection(userId, collection as any);
            localCache.addOrUpdatePrompt(userId, prompt as any);
        }
        console.log('[IPC] ✅ Collection and prompt created');
        return { collection, prompt };
    } catch (error: any) {
        Sentry.captureException(error, { tags: { component: 'prompt-library-handlers', op: 'prompt-library:create-collection-and-save' } });
        console.error('[IPC] ❌ Error creating collection and saving prompt:', error);
        throw error;
    }
});

ipcMain.handle('prompt-library:update-prompt', async (event, { promptId, updates }) => {
    try {
        console.log('[IPC] prompt-library:update-prompt:', promptId);
        const prompt = await getService().updatePrompt(promptId, updates);
        console.log('[IPC] ✅ Prompt updated');
        return prompt;
    } catch (error: any) {
        Sentry.captureException(error, { tags: { component: 'prompt-library-handlers', op: 'prompt-library:update-prompt' } });
        console.error('[IPC] ❌ Error updating prompt:', error);
        throw error;
    }
});

ipcMain.handle('prompt-library:delete-prompt', async (event, { promptId }) => {
    try {
        console.log('[IPC] prompt-library:delete-prompt:', promptId);
        await getService().deletePrompt(promptId);
        console.log('[IPC] ✅ Prompt deleted');
        return { success: true };
    } catch (error: any) {
        Sentry.captureException(error, { tags: { component: 'prompt-library-handlers', op: 'prompt-library:delete-prompt' } });
        console.error('[IPC] ❌ Error deleting prompt:', error);
        throw error;
    }
});

ipcMain.handle('prompt-library:toggle-favorite', async (event, { promptId }) => {
    try {
        console.log('[IPC] prompt-library:toggle-favorite:', promptId);
        const prompt = await getService().toggleFavorite(promptId);
        console.log('[IPC] ✅ Favorite toggled');
        return prompt;
    } catch (error: any) {
        Sentry.captureException(error, { tags: { component: 'prompt-library-handlers', op: 'prompt-library:toggle-favorite' } });
        console.error('[IPC] ❌ Error toggling favorite:', error);
        throw error;
    }
});

// ============================================
// SHARING
// ============================================

ipcMain.handle('prompt-library:get-share-link', async (event, { collectionId }) => {
    try {
        if (!authState.isAuthenticated) throw new Error('Not authenticated');
        Sentry.addBreadcrumb({
            category: 'sharing',
            message: 'IPC get collection share link',
            level: 'info',
            data: { collectionId, userId: authState.currentUserId || 'unknown' },
        });
        console.log('[IPC] prompt-library:get-share-link:', collectionId);
        const result = await getService().getOrCreateShareToken(collectionId);
        console.log('[IPC] ✅ Share token generated for collection:', collectionId);
        return result; // { shareToken, shareUrl }
    } catch (error: any) {
        console.error('[IPC] ❌ Error generating share link:', error);
        Sentry.captureException(error, {
            tags: { component: 'prompt-library-handlers', handler: 'prompt-library:get-share-link' },
            extra: { collectionId },
        });
        throw error;
    }
});

ipcMain.handle('prompt-library:get-prompt-share-link', async (event, { promptId }) => {
    try {
        if (!authState.isAuthenticated) throw new Error('Not authenticated');
        Sentry.addBreadcrumb({
            category: 'sharing',
            message: 'IPC get prompt share link',
            level: 'info',
            data: { promptId, userId: authState.currentUserId || 'unknown' },
        });
        console.log('[IPC] prompt-library:get-prompt-share-link:', promptId);
        const result = await getService().getOrCreatePromptShareToken(promptId);
        console.log('[IPC] ✅ Share token generated for prompt:', promptId);
        return result; // { shareToken, shareUrl, webUrl }
    } catch (error: any) {
        console.error('[IPC] ❌ Error generating prompt share link:', error);
        Sentry.captureException(error, {
            tags: { component: 'prompt-library-handlers', handler: 'prompt-library:get-prompt-share-link' },
            extra: { promptId },
        });
        throw error;
    }
});

ipcMain.handle('prompt-library:get-shared-prompt', async (event, { token }) => {
    try {
        Sentry.addBreadcrumb({
            category: 'sharing',
            message: 'IPC get shared prompt',
            level: 'info',
            data: { tokenLength: token?.length || 0 },
        });
        const result = await getService().getSharedPrompt(token);
        console.log('[IPC] ✅ Shared prompt loaded:', result.id);
        return result;
    } catch (error: any) {
        console.error('[IPC] ❌ Error loading shared prompt:', error);
        Sentry.captureException(error, {
            tags: { component: 'prompt-library-handlers', handler: 'prompt-library:get-shared-prompt' },
            extra: { tokenLength: token?.length || 0 },
        });
        throw error;
    }
});

ipcMain.handle('prompt-library:get-shared-collection', async (event, { token }) => {
    try {
        Sentry.addBreadcrumb({
            category: 'sharing',
            message: 'IPC get shared collection',
            level: 'info',
            data: { tokenLength: token?.length || 0, userId: authState.currentUserId || 'anonymous' },
        });
        const result = await getService().getSharedCollection(token);
        console.log('[IPC] ✅ Shared collection loaded:', result.id);
        return result;
    } catch (error: any) {
        console.error('[IPC] ❌ Error loading shared collection:', error);
        Sentry.captureException(error, {
            tags: { component: 'prompt-library-handlers', handler: 'prompt-library:get-shared-collection' },
            extra: { tokenLength: token?.length || 0, userId: authState.currentUserId || null },
        });
        throw error;
    }
});

ipcMain.handle('prompt-library:save-shared-collection', async (event, { originalCollectionId }) => {
    try {
        if (!authState.isAuthenticated) throw new Error('Not authenticated');
        const userId = authState.currentUserId;
        Sentry.addBreadcrumb({
            category: 'sharing',
            message: 'IPC save shared collection',
            level: 'info',
            data: { originalCollectionId, userId: userId || 'unknown' },
        });
        console.log('[IPC] prompt-library:save-shared-collection:', originalCollectionId);
        const result = await getService().saveSharedCollection(originalCollectionId);

        // Update local cache so the new collection appears immediately
        if (userId && !result.alreadyExisted) {
            localCache.addOrUpdateCollection(userId, result.collection as any);
            // Re-fetch prompts so the copied prompts also land in cache
            try {
                const prompts = await getService().getPrompts();
                localCache.setPrompts(userId, prompts as any);
            } catch (_) { /* best-effort */ }
        }

        console.log('[IPC] ✅ Shared collection saved. alreadyExisted:', result.alreadyExisted);
        return result; // { collection, alreadyExisted }
    } catch (error: any) {
        console.error('[IPC] ❌ Error saving shared collection:', error);
        Sentry.captureException(error, {
            tags: { component: 'prompt-library-handlers', handler: 'prompt-library:save-shared-collection' },
            extra: { originalCollectionId, userId: authState.currentUserId || null },
        });
        throw error;
    }
});

console.log('[PromptLibraryHandlers] ✅ IPC handlers registered');

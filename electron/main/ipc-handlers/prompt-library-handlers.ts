import { ipcMain } from 'electron';
import { PromptLibraryService } from '../database/services/prompt-library-service';

// ============================================
// PROMPT LIBRARY IPC HANDLERS
// ============================================

const service = new PromptLibraryService();

/** Wrap a handler so failures are logged with the channel name and re-thrown to the renderer. */
function handle<T>(channel: string, fn: (args: any) => Promise<T>) {
    ipcMain.handle(channel, async (_event, args) => {
        try {
            return await fn(args ?? {});
        } catch (error) {
            console.error(`[PromptLibrary] ${channel} failed:`, error);
            throw error;
        }
    });
}

// ============================================
// COLLECTIONS
// ============================================

handle('prompt-library:get-collections', () => service.getCollections());

handle('prompt-library:get-all', () => service.getPrompts());

handle('prompt-library:create-collection', ({ name, icon }) => service.createCollection(name, icon));

handle('prompt-library:rename-collection', ({ collectionId, name }) => service.renameCollection(collectionId, name));

handle('prompt-library:delete-collection', async ({ collectionId }) => {
    await service.deleteCollection(collectionId);
    return { success: true };
});

// ============================================
// PROMPTS
// ============================================

handle('prompt-library:save-prompt', ({ collectionId, title, content, metadata }) =>
    service.savePrompt(collectionId, title, content, metadata));

handle('prompt-library:create-collection-and-save', ({ collectionName, collectionIcon, promptTitle, promptContent, metadata }) =>
    service.createCollectionAndSavePrompt(collectionName, promptTitle, promptContent, collectionIcon, metadata));

handle('prompt-library:update-prompt', ({ promptId, updates }) => service.updatePrompt(promptId, updates));

handle('prompt-library:delete-prompt', async ({ promptId }) => {
    await service.deletePrompt(promptId);
    return { success: true };
});

handle('prompt-library:toggle-favorite', ({ promptId }) => service.toggleFavorite(promptId));

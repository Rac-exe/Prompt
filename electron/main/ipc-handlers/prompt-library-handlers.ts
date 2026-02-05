import { ipcMain } from 'electron';
import { PromptLibraryService } from '../database/services/prompt-library-service';

// ============================================
// PROMPT LIBRARY IPC HANDLERS
// ============================================
// These handlers connect the renderer process to the
// PromptLibraryService for Supabase persistence

// Lazy-load service to avoid "Supabase not initialized" error
// Service is created on first use, after Supabase is initialized
let promptLibraryService: PromptLibraryService | null = null;
const getService = () => {
    if (!promptLibraryService) {
        promptLibraryService = new PromptLibraryService();
    }
    return promptLibraryService;
};

// ============================================
// COLLECTIONS
// ============================================

/**
 * Get all collections for the current user
 */
ipcMain.handle('prompt-library:get-collections', async () => {
    try {
        console.log('[IPC] prompt-library:get-collections');
        const collections = await getService().getCollections();
        console.log('[IPC] ✅ Loaded', collections.length, 'collections');
        return collections;
    } catch (error: any) {
        console.error('[IPC] ❌ Error loading collections:', error);
        throw error;
    }
});

/**
 * Get all prompts (with collection info)
 */
ipcMain.handle('prompt-library:get-all', async () => {
    try {
        console.log('[IPC] prompt-library:get-all');
        const prompts = await getService().getPrompts();
        console.log('[IPC] ✅ Loaded', prompts.length, 'prompts');
        return prompts;
    } catch (error: any) {
        console.error('[IPC] ❌ Error loading prompts:', error);
        throw error;
    }
});

/**
 * Create a new collection
 */
ipcMain.handle('prompt-library:create-collection', async (event, { name, icon }) => {
    try {
        console.log('[IPC] prompt-library:create-collection:', name);
        const collection = await getService().createCollection(name, icon);
        console.log('[IPC] ✅ Collection created:', collection.id);
        return collection;
    } catch (error: any) {
        console.error('[IPC] ❌ Error creating collection:', error);
        throw error;
    }
});

/**
 * Rename a collection
 */
ipcMain.handle('prompt-library:rename-collection', async (event, { collectionId, name }) => {
    try {
        console.log('[IPC] prompt-library:rename-collection:', collectionId, name);
        const collection = await getService().renameCollection(collectionId, name);
        console.log('[IPC] ✅ Collection renamed');
        return collection;
    } catch (error: any) {
        console.error('[IPC] ❌ Error renaming collection:', error);
        throw error;
    }
});

/**
 * Delete a collection (and all its prompts)
 */
ipcMain.handle('prompt-library:delete-collection', async (event, { collectionId }) => {
    try {
        console.log('[IPC] prompt-library:delete-collection:', collectionId);
        await getService().deleteCollection(collectionId);
        console.log('[IPC] ✅ Collection deleted');
        return { success: true };
    } catch (error: any) {
        console.error('[IPC] ❌ Error deleting collection:', error);
        throw error;
    }
});

// ============================================
// PROMPTS
// ============================================

/**
 * Save a new prompt to a collection
 */
ipcMain.handle('prompt-library:save-prompt', async (event, { collectionId, title, content, metadata }) => {
    try {
        console.log('[IPC] prompt-library:save-prompt:', { collectionId, title });
        const prompt = await getService().savePrompt(collectionId, title, content, metadata);
        console.log('[IPC] ✅ Prompt saved:', prompt.id);
        return prompt;
    } catch (error: any) {
        console.error('[IPC] ❌ Error saving prompt:', error);
        throw error;
    }
});

/**
 * Create collection and save prompt in one operation
 */
ipcMain.handle('prompt-library:create-collection-and-save', async (event, { collectionName, collectionIcon, promptTitle, promptContent, metadata }) => {
    try {
        console.log('[IPC] prompt-library:create-collection-and-save:', collectionName, promptTitle);

        // Create collection first
        const collection = await getService().createCollection(collectionName, collectionIcon);

        // Save prompt to new collection
        const prompt = await getService().savePrompt(collection.id, promptTitle, promptContent, metadata);

        console.log('[IPC] ✅ Collection and prompt created');
        return { collection, prompt };
    } catch (error: any) {
        console.error('[IPC] ❌ Error creating collection and saving prompt:', error);
        throw error;
    }
});

/**
 * Update a prompt
 */
ipcMain.handle('prompt-library:update-prompt', async (event, { promptId, updates }) => {
    try {
        console.log('[IPC] prompt-library:update-prompt:', promptId);
        const prompt = await getService().updatePrompt(promptId, updates);
        console.log('[IPC] ✅ Prompt updated');
        return prompt;
    } catch (error: any) {
        console.error('[IPC] ❌ Error updating prompt:', error);
        throw error;
    }
});

/**
 * Delete a prompt
 */
ipcMain.handle('prompt-library:delete-prompt', async (event, { promptId }) => {
    try {
        console.log('[IPC] prompt-library:delete-prompt:', promptId);
        await getService().deletePrompt(promptId);
        console.log('[IPC] ✅ Prompt deleted');
        return { success: true };
    } catch (error: any) {
        console.error('[IPC] ❌ Error deleting prompt:', error);
        throw error;
    }
});

/**
 * Toggle favorite status of a prompt
 */
ipcMain.handle('prompt-library:toggle-favorite', async (event, { promptId }) => {
    try {
        console.log('[IPC] prompt-library:toggle-favorite:', promptId);
        const prompt = await getService().toggleFavorite(promptId);
        console.log('[IPC] ✅ Favorite toggled');
        return prompt;
    } catch (error: any) {
        console.error('[IPC] ❌ Error toggling favorite:', error);
        throw error;
    }
});

console.log('[PromptLibraryHandlers] ✅ IPC handlers registered');

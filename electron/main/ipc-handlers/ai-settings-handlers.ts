import { ipcMain } from 'electron';
import { aiSettings, AISettingsUpdate } from '../database/services/ai-settings-service';
import { AppWindowManager } from '../windows/app-window-manager';
import { OverlayWindowManager } from '../overlay/overlay-window-manager';

/**
 * AI provider settings IPC (Settings > AI provider, onboarding).
 * The renderer never receives the raw keys, only AISettingsView.
 */
export function registerAISettingsHandlers(appWindowManager: AppWindowManager, overlayManager: OverlayWindowManager) {
    aiSettings.onChange((view) => {
        appWindowManager.send('ai-settings:changed', view);
        overlayManager.send('ai-settings:changed', view);
    });

    ipcMain.handle('ai-settings:get', () => aiSettings.getView());

    ipcMain.handle('ai-settings:validate-key', (_event, key: string) => aiSettings.validateOpenRouterKey(key));

    /**
     * Save settings. A new OpenRouter key is checked with OpenRouter first and
     * rejected if invalid, so a typo can't replace a working key.
     */
    ipcMain.handle('ai-settings:save', async (_event, update: AISettingsUpdate) => {
        const key = typeof update?.openrouterApiKey === 'string' ? update.openrouterApiKey.trim() : '';
        if (key) {
            const check = await aiSettings.validateOpenRouterKey(key);
            if (!check.valid) return { ok: false, error: check.error ?? 'Invalid API key', settings: aiSettings.getView() };
        }
        const settings = aiSettings.save({
            ...(update?.openrouterApiKey !== undefined ? { openrouterApiKey: update.openrouterApiKey } : {}),
            ...(update?.deepgramApiKey !== undefined ? { deepgramApiKey: update.deepgramApiKey } : {}),
            ...(update?.optimizerModel ? { optimizerModel: update.optimizerModel } : {}),
            ...(update?.ragModel ? { ragModel: update.ragModel } : {}),
        });
        return { ok: true, settings };
    });

    ipcMain.handle('ai-settings:list-models', async () => {
        try {
            return { models: await aiSettings.listModels() };
        } catch (err) {
            console.error('[AISettings] Could not load the OpenRouter model list:', err);
            return { models: [], error: `Could not load models from OpenRouter: ${(err as Error).message}` };
        }
    });
}

import { ipcMain } from 'electron';
import { SettingsService } from '../database/services/settings-service';
import { authState } from '../utils/auth-state';
import { OverlayWindowManager } from '../overlay/overlay-window-manager';

const DEFAULT_SETTINGS_RESPONSE = { theme: 'dark', font_size: 'medium', font_family: 'inter', prompt_instructions: '' };

export function registerSettingsHandlers(overlayManager: OverlayWindowManager) {
    const service = new SettingsService();

    // ============================================
    // SETTINGS IPC HANDLERS
    // ============================================

    // Direct theme relay — renderer sends this immediately on toggle so the
    // overlay updates in sync with the main window, without waiting for the DB.
    ipcMain.on('overlay:settings-update', (_event, settings) => {
        overlayManager.send('overlay:settings-update', settings);
    });

    // Load settings
    ipcMain.handle('settings:load', async () => {
        try {
            return await service.getOrCreateSettings(authState.currentUserId!);
        } catch (error) {
            console.error('[Settings] Error loading settings:', error);
            return DEFAULT_SETTINGS_RESPONSE;
        }
    });

    // Save settings
    ipcMain.handle('settings:save', async (_event, settings) => {
        // Broadcast immediately so the overlay theme changes in sync with the main window.
        overlayManager.send('overlay:settings-update', settings);
        try {
            return await service.upsertUserSettings(authState.currentUserId!, settings);
        } catch (error) {
            console.error('[Settings] Error saving settings:', error);
            throw error;
        }
    });
}

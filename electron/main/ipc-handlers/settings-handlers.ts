import { ipcMain } from 'electron';
import { SettingsService } from '../database/services/settings-service';
import { authState } from '../utils/auth-state';
import { localCache } from '../database/local-cache';

// Lazy load service
let settingsService: SettingsService | null = null;

function getService() {
    if (!settingsService) settingsService = new SettingsService();
    return settingsService;
}

import { OverlayWindowManager } from '../overlay/overlay-window-manager';

export function registerSettingsHandlers(overlayManager: OverlayWindowManager) {
    const service = getService();

    // ============================================
    // SETTINGS IPC HANDLERS
    // ============================================

    // Load user settings
    ipcMain.handle('settings:load', async () => {
        try {
            if (!authState.isAuthenticated || !authState.currentUserId) {
                console.log('[Settings] User not authenticated, returning default settings');
                return { theme: 'dark', font_size: 'medium', font_family: 'inter', prompt_instructions: '' };
            }

            const settings = await service.getOrCreateSettings(authState.currentUserId);
            // Cache for offline use
            localCache.setSettings(authState.currentUserId, settings);
            console.log('[Settings] ✅ Settings loaded for user:', authState.currentUserId);
            return settings;
        } catch (error) {
            console.error('[Settings] Error loading settings:', error);
            // Try cached settings first, then defaults
            if (authState.currentUserId) {
                const cached = localCache.getSettings(authState.currentUserId);
                if (cached) {
                    console.warn('[Settings] Offline — returning cached settings');
                    return cached;
                }
            }
            return { theme: 'dark', font_size: 'medium', font_family: 'inter', prompt_instructions: '' };
        }
    });

    // Save user settings
    ipcMain.handle('settings:save', async (event, settings) => {
        try {
            if (!authState.isAuthenticated || !authState.currentUserId) {
                throw new Error('User must be authenticated to save settings');
            }

            const saved = await service.upsertUserSettings(authState.currentUserId, settings);
            console.log('[Settings] ✅ Settings saved for user:', authState.currentUserId);

            // Broadcast new settings to the overlay so it can update its UI instantly
            overlayManager.send('overlay:settings-update', settings);

            return saved;
        } catch (error) {
            console.error('[Settings] Error saving settings:', error);
            throw error;
        }
    });
}

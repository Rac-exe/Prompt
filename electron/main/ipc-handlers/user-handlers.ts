import { ipcMain } from 'electron';
import { UserService } from '../database/services/user-service';
import { MemoryService, MemoryType, MemorySource } from '../database/services/memory-service';
import { SettingsService } from '../database/services/settings-service';
import { AppWindowManager } from '../windows/app-window-manager';
import { authState } from '../utils/auth-state';
import { localCache } from '../database/local-cache';

// Lazy load services
let userService: UserService | null = null;
let memoryService: MemoryService | null = null;
let settingsService: SettingsService | null = null;

function getService() {
    if (!userService) userService = new UserService();
    if (!memoryService) memoryService = new MemoryService();
    if (!settingsService) settingsService = new SettingsService();
    return { userService, memoryService, settingsService };
}

export function registerUserHandlers(appWindowManager: AppWindowManager) {
    const { userService: service, memoryService: memory, settingsService: settings } = getService();

    // ============================================
    // USER PROFILE & PREFERENCES IPC HANDLERS
    // ============================================

    // App Window: Request user data
    ipcMain.on('app:request-user-data', async () => {
        try {
            const userData = await service.getCompleteUserData();
            if (userData && appWindowManager) {
                appWindowManager.send('user-data-loaded', userData);
            }
        } catch (error) {
            console.error('[User] Failed to load user data:', error);
        }
    });

    // Update Profile
    ipcMain.on('user:update-profile', async (event, updates) => {
        try {
            if (!authState.isAuthenticated) {
                console.error('[User] Cannot update profile: not authenticated');
                return;
            }

            await service.updateProfile(updates);

            // Cache new avatar immediately if provided
            if (updates.avatar_url && authState.currentUserId) {
                try {
                    const avatarRes = await fetch(updates.avatar_url);
                    if (avatarRes.ok) {
                        const arrayBuffer = await avatarRes.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);
                        const mimeType = avatarRes.headers.get('content-type') || 'image/jpeg';
                        const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
                        localCache.setAvatar(authState.currentUserId, base64);
                        console.log('[User] ✅ New avatar cached for offline use');
                    }
                } catch (err) {
                    console.warn('[User] Could not cache new avatar:', err);
                }
            }

            if (appWindowManager) {
                appWindowManager.send('user:profile-updated');

                // Send updated user data
                const userData = await service.getCompleteUserData();
                appWindowManager.send('user-data-loaded', userData);
            }

            console.log('[User] ✅ Profile updated');
        } catch (error) {
            console.error('[User] Error updating profile:', error);
        }
    });

    // Update Preferences
    ipcMain.on('user:update-preferences', async (event, updates) => {
        try {
            if (!authState.isAuthenticated) {
                console.error('[User] Cannot update preferences: not authenticated');
                return;
            }

            await service.updatePreferences(updates);

            if (appWindowManager) {
                appWindowManager.send('user:preferences-updated');

                // Send updated user data
                const userData = await service.getCompleteUserData();
                appWindowManager.send('user-data-loaded', userData);
            }

            console.log('[User] ✅ Preferences updated');
        } catch (error) {
            console.error('[User] Error updating preferences:', error);
        }
    });

    // Set Personalization Prompt
    ipcMain.on('user:set-personalization-prompt', async (event, prompt: string) => {
        try {
            if (!authState.isAuthenticated) {
                console.error('[User] Cannot set personalization prompt: not authenticated');
                return;
            }

            await service.setPersonalizationPrompt(prompt);

            if (appWindowManager) {
                appWindowManager.send('user:preferences-updated');
            }

            console.log('[User] ✅ Personalization prompt updated');
        } catch (error) {
            console.error('[User] Error setting personalization prompt:', error);
        }
    });

    // ============================================
    // MEMORY IPC HANDLERS
    // ============================================

    // Get all memory for current user
    ipcMain.handle('memory:get', async () => {
        try {
            if (!authState.isAuthenticated) return { user: {}, behavioral: {}, context: {} };
            const result = await memory.getMemory();
            return result;
        } catch (error) {
            console.error('[Memory] Failed to get memory:', error);
            return { user: {}, behavioral: {}, context: {} };
        }
    });

    // Upsert a single memory fact (called from UI — source is 'explicit')
    ipcMain.handle('memory:upsert', async (
        _event,
        data: { memoryType: MemoryType; key: string; value: string; source?: MemorySource; confidence?: number },
    ) => {
        try {
            if (!authState.isAuthenticated) throw new Error('Not authenticated');
            await memory.upsertMemoryEntry(
                data.memoryType,
                data.key,
                data.value,
                data.source ?? 'explicit',
                data.confidence ?? 1.0,
            );
            return { success: true };
        } catch (error) {
            console.error('[Memory] Failed to upsert memory entry:', error);
            const msg = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: msg };
        }
    });

    // Delete a single memory fact
    ipcMain.handle('memory:delete', async (
        _event,
        data: { memoryType: MemoryType; key: string },
    ) => {
        try {
            if (!authState.isAuthenticated) throw new Error('Not authenticated');
            await memory.deleteMemoryEntry(data.memoryType, data.key);
            return { success: true };
        } catch (error) {
            console.error('[Memory] Failed to delete memory entry:', error);
            const msg = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: msg };
        }
    });

    // ============================================
    // MEMORY TOGGLE HANDLERS
    // ============================================

    // Get the memory_enabled toggle state
    ipcMain.handle('memory:get-enabled', async () => {
        try {
            if (!authState.isAuthenticated) return true; // Default on
            const profile = await service.getUserProfile();
            if (!profile) return true;
            const userSettings = await settings.getUserSettings(profile.id);
            return userSettings?.memory_enabled !== false; // Default true
        } catch (error) {
            console.error('[Memory] Failed to get memory enabled state:', error);
            return true; // Fail-open
        }
    });

    // Set the memory_enabled toggle state
    ipcMain.handle('memory:set-enabled', async (
        _event,
        enabled: boolean,
    ) => {
        try {
            if (!authState.isAuthenticated) throw new Error('Not authenticated');
            const profile = await service.getUserProfile();
            if (!profile) throw new Error('No profile found');
            await settings.upsertUserSettings(profile.id, { memory_enabled: enabled });
            console.log(`[Memory] Toggle set to ${enabled ? 'ON' : 'OFF'}`);
            return { success: true };
        } catch (error) {
            console.error('[Memory] Failed to set memory enabled state:', error);
            const msg = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: msg };
        }
    });
}

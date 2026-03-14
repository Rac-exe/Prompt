import { ipcMain } from 'electron';
import { UserService } from '../database/services/user-service';
import { AppWindowManager } from '../windows/app-window-manager';
import { authState } from '../utils/auth-state';
import { localCache } from '../database/local-cache';

// Lazy load service
let userService: UserService | null = null;

function getService() {
    if (!userService) userService = new UserService();
    return userService;
}

export function registerUserHandlers(appWindowManager: AppWindowManager) {
    const service = getService();

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
}

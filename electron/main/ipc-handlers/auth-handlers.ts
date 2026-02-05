import { ipcMain } from 'electron';
import { AuthService } from '../database/services/auth-service';
import { UserService } from '../database/services/user-service';
import { ChatService } from '../database/services/chat-service';
import { PromptLibraryService } from '../database/services/prompt-library-service';
import { SupabaseClientManager } from '../database/supabase-client';
import { AppWindowManager } from '../windows/app-window-manager';
import { authState } from '../utils/auth-state';

// Services (lazy loaded)
let authService: AuthService | null = null;
let userService: UserService | null = null;
let chatService: ChatService | null = null;
let promptLibraryService: PromptLibraryService | null = null;

function getServices() {
    if (!authService) authService = new AuthService();
    if (!userService) userService = new UserService();
    if (!chatService) chatService = new ChatService();
    if (!promptLibraryService) promptLibraryService = new PromptLibraryService();
    return { authService, userService, chatService, promptLibraryService };
}

/**
 * Check for existing session and restore state
 */
export async function checkAndRestoreSession(appWindowManager: AppWindowManager): Promise<boolean> {
    const { authService, userService } = getServices();

    try {
        console.log('[Auth] Checking for existing session...');
        const { session, error } = await authService.getSession();

        if (error || !session) {
            console.log('[Auth] No valid session found');
            authState.isAuthenticated = false;
            authState.currentUserId = null;
            return false;
        }

        console.log('[Auth] ✅ Valid session found, user authenticated');
        authState.isAuthenticated = true;
        authState.currentUserId = session.user.id;

        // Load user data and notify renderer
        const userData = await userService.getCompleteUserData();
        if (userData && appWindowManager) {
            appWindowManager.send('user-data-loaded', userData);
        }

        return true;
    } catch (error) {
        console.error('[Auth] Error checking session:', error);
        authState.isAuthenticated = false;
        authState.currentUserId = null;
        return false;
    }
}

/**
 * Handle successful authentication (updates state, loads data)
 */
async function handleSuccessfulAuth(appWindowManager: AppWindowManager) {
    const { authService, userService, chatService, promptLibraryService } = getServices();

    try {
        // Get user data
        const { user } = await authService.getCurrentUser();
        if (!user) {
            console.error('[Auth] No user after authentication');
            return;
        }

        authState.isAuthenticated = true;
        authState.currentUserId = user.id;

        // Load complete user data
        const userData = await userService.getCompleteUserData();

        // 1. Send Auth State
        console.log('[Auth] 📤 Sending authenticated state to renderer');
        appWindowManager.send('auth:state-changed', {
            isAuthenticated: true,
            user: userData,
        });

        // 2. Load Chats
        const chats = await chatService.getChats();
        appWindowManager.send('chats-loaded', { chats });

        // 3. Load Prompt Library
        const library = await promptLibraryService.getFullLibrary();
        appWindowManager.send('prompt-library:loaded', library);

        console.log('[Auth] ✅ User authenticated and data loaded');
    } catch (error) {
        console.error('[Auth] Error handling successful auth:', error);
    }
}

/**
 * Register Auth IPC handlers
 */
export function registerAuthHandlers(appWindowManager: AppWindowManager) {
    const { authService } = getServices();

    // ============================================
    // AUTH IPC HANDLERS
    // ============================================

    // Sign Up
    ipcMain.on('auth:sign-up', async (event, data: { name: string; dob: string; email: string; password: string }) => {
        try {
            console.log('[Auth] Sign up request for:', data.email);

            const { user, error } = await authService!.signUp(data);

            if (error || !user) {
                console.error('[Auth] Sign up failed:', error?.message);
                appWindowManager.send('auth:state-changed', {
                    isAuthenticated: false,
                    user: null,
                    error: error?.message || 'Sign up failed',
                });
                return;
            }

            console.log('[Auth] ✅ Sign up successful, signing in...');

            // Auto-sign in after signup
            const { session: signInSession, error: signInError } = await authService!.signIn({
                email: data.email,
                password: data.password,
            });

            if (signInError || !signInSession) {
                console.error('[Auth] Auto sign-in after signup failed:', signInError?.message);
                return;
            }

            await handleSuccessfulAuth(appWindowManager);
        } catch (error) {
            console.error('[Auth] Unexpected sign up error:', error);
            appWindowManager.send('auth:state-changed', {
                isAuthenticated: false,
                user: null,
                error: 'Sign up failed',
            });
        }
    });

    // Sign In
    ipcMain.on('auth:sign-in', async (event, data: { email: string; password: string }) => {
        try {
            console.log('[Auth] Sign in request for:', data.email);

            const { session, error } = await authService!.signIn(data);

            if (error || !session) {
                console.error('[Auth] Sign in failed:', error?.message);
                appWindowManager.send('auth:state-changed', {
                    isAuthenticated: false,
                    user: null,
                    error: error?.message || 'Sign in failed',
                });
                return;
            }

            console.log('[Auth] ✅ Sign in successful');
            await handleSuccessfulAuth(appWindowManager);
        } catch (error) {
            console.error('[Auth] Unexpected sign in error:', error);
            appWindowManager.send('auth:state-changed', {
                isAuthenticated: false,
                user: null,
                error: 'Sign in failed',
            });
        }
    });

    // Sign Out
    ipcMain.on('auth:sign-out', async () => {
        try {
            console.log('[Auth] Sign out request');
            await authService!.signOut();

            authState.isAuthenticated = false;
            authState.currentUserId = null;

            console.log('[Auth] ✅ User signed out');

            appWindowManager.send('auth:state-changed', {
                isAuthenticated: false,
                user: null
            });
        } catch (error) {
            console.error('[Auth] Error signing out:', error);
        }
    });

    // App Window: Sign Out (Legacy/System Tray)
    ipcMain.on('app:sign-out', async () => {
        try {
            console.log('[Auth] Sign out request (app:sign-out)');
            await authService!.signOut();

            authState.isAuthenticated = false;
            authState.currentUserId = null;

            console.log('[Auth] ✅ User signed out');

            appWindowManager.send('auth:state-changed', {
                isAuthenticated: false,
                user: null
            });
        } catch (error) {
            console.error('[Auth] Error signing out:', error);
        }
    });

    // Check Auth Status
    ipcMain.on('auth:check', async () => {
        try {
            console.log('[Auth] 📥 Renderer requested auth check');
            const isAuth = await checkAndRestoreSession(appWindowManager);

            if (isAuth) {
                // Data loading is handled in checkAndRestoreSession -> or we should call handleSuccessfulAuth?
                // Wait, checkAndRestoreSession only loads user data. It doesn't load chats/library.
                // The original code DID load chats/library in auth:check handler.

                // Let's replicate original behavior:
                await handleSuccessfulAuth(appWindowManager);
            } else {
                console.log('[Auth] 📤 Sending unauthenticated state to renderer');
                appWindowManager.send('auth:state-changed', {
                    isAuthenticated: false,
                    user: null,
                });
            }
        } catch (error) {
            console.error('[Auth] Error checking auth:', error);
            appWindowManager.send('auth:state-changed', {
                isAuthenticated: false,
                user: null,
                error: 'Auth check failed',
            });
        }
    });
}

import { ipcMain, shell } from 'electron';
import * as http from 'http';
import * as Sentry from '@sentry/electron/main';
import { logger } from '@sentry/core';
import { AuthService } from '../database/services/auth-service';
import { UserService } from '../database/services/user-service';
import { ChatService } from '../database/services/chat-service';
import { PromptLibraryService } from '../database/services/prompt-library-service';
import { SupabaseClientManager } from '../database/supabase-client';
import { AppWindowManager } from '../windows/app-window-manager';
import { authState } from '../utils/auth-state';
import { networkMonitor } from './network-monitor-singleton';
import { localCache } from '../database/local-cache';

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
    const { authService } = getServices();

    try {
        console.log('[Auth] Checking for existing session...');
        const { session, error } = await authService.getSession();

        if (error || !session) {
            console.log('[Auth] No valid session found');
            authState.isAuthenticated = false;
            authState.currentUserId = null;
            return false;
        }

        // Set auth state from the locally-stored session token — no network required
        authState.isAuthenticated = true;
        authState.currentUserId = session.user.id;
        console.log('[Auth] ✅ Valid session found, user authenticated (offline-safe)');

        // handleSuccessfulAuth already handles online/offline branching for data loading
        await handleSuccessfulAuth(appWindowManager, session.user);

        return true;
    } catch (error) {
        console.error('[Auth] Error checking session:', error);
        Sentry.captureException(error);
        authState.isAuthenticated = false;
        authState.currentUserId = null;
        return false;
    }
}

/**
 * Handle successful authentication (updates state, loads data)
 */
export async function handleSuccessfulAuth(appWindowManager: AppWindowManager, cachedUser?: any) {
    const { authService, userService, chatService, promptLibraryService } = getServices();

    try {
        let user = cachedUser;

        // Only make network call if we don't already have user data and we're online
        if (!user) {
            if (!networkMonitor.isOnline) {
                console.warn('[Auth] Offline — cannot validate user via network. Aborting auth load.');
                return;
            }
            const result = await authService.getCurrentUser();
            user = result.user;
        }

        if (!user) {
            console.error('[Auth] No user after authentication');
            return;
        }

        authState.isAuthenticated = true;
        authState.currentUserId = user.id;
        authState.currentUserEmail = user.email ?? null;

        // Build user data object
        let userData: any = null;
        if (networkMonitor.isOnline) {
            try {
                userData = await userService.getCompleteUserData();
                // Cache avatar for offline use if present
                if (userData?.profile?.avatar_url) {
                    try {
                        const avatarRes = await fetch(userData.profile.avatar_url);
                        if (avatarRes.ok) {
                            const arrayBuffer = await avatarRes.arrayBuffer();
                            const buffer = Buffer.from(arrayBuffer);
                            const mimeType = avatarRes.headers.get('content-type') || 'image/jpeg';
                            const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
                            localCache.setAvatar(user.id, base64);
                            console.log('[Auth] ✅ Avatar cached for offline use');
                        }
                    } catch (avatarErr) {
                        console.warn('[Auth] Could not cache avatar:', avatarErr);
                    }
                }
            } catch (e) {
                console.warn('[Auth] Could not load user data from network:', e);
            }
        }

        // Fallback: construct minimal user data from the session user object
        if (!userData) {
            userData = {
                id: user.id,
                email: user.email,
                profile: {
                    id: user.id,
                    email: user.email,
                    name: user.user_metadata?.full_name || user.email,
                    avatar_url: localCache.getAvatar(user.id) || user.user_metadata?.avatar_url || null,
                },
                preferences: {},
            };
        }

        Sentry.setUser({ id: user.id });
        appWindowManager.send('sentry:set-user', { id: user.id });
        logger.info(logger.fmt`auth.login_success user=${user.id} email=${user.email ?? ''}`);

        // 1. Send Auth State
        console.log('[Auth] 📤 Sending authenticated state to renderer');
        appWindowManager.send('auth:state-changed', {
            isAuthenticated: true,
            user: userData,
        });

        // 2. Load Chats (from Supabase if online, from cache if offline)
        try {
            if (networkMonitor.isOnline) {
                const chats = await chatService.getChats();
                appWindowManager.send('chats-loaded', { chats });
                localCache.setChats(user.id, chats as any);
            } else {
                const cachedChats = localCache.getChats(user.id);
                appWindowManager.send('chats-loaded', { chats: cachedChats });
                console.warn('[Auth] Offline — returning', cachedChats.length, 'cached chats');
            }
        } catch (e) {
            const cachedChats = localCache.getChats(user.id);
            appWindowManager.send('chats-loaded', { chats: cachedChats });
        }

        // 3. Load Prompt Library (from Supabase if online, from cache if offline)
        try {
            if (networkMonitor.isOnline) {
                const library = await promptLibraryService.getFullLibrary();
                appWindowManager.send('prompt-library:loaded', library);
                if (library.collections) localCache.setCollections(user.id, library.collections as any);
                if (library.prompts) localCache.setPrompts(user.id, library.prompts as any);
            } else {
                const collections = localCache.getCollections(user.id);
                const prompts = localCache.getPrompts(user.id);
                appWindowManager.send('prompt-library:loaded', { collections, prompts });
                console.warn('[Auth] Offline — returning cached prompt library');
            }
        } catch (e) {
            const collections = localCache.getCollections(user.id);
            const prompts = localCache.getPrompts(user.id);
            appWindowManager.send('prompt-library:loaded', { collections, prompts });
        }

        console.log('[Auth] ✅ User authenticated and data loaded');
    } catch (error) {
        console.error('[Auth] Error handling successful auth:', error);
        Sentry.captureException(error);
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
            Sentry.captureException(error);
            appWindowManager.send('auth:state-changed', {
                isAuthenticated: false,
                user: null,
                error: 'Sign up failed',
            });
        }
    });

    // Sign In
    ipcMain.on('auth:sign-in', async (event, data: { email: string; password: string }) => {
        Sentry.addBreadcrumb({ category: 'auth', message: 'Login attempt', level: 'info' });
        logger.info(logger.fmt`auth.login_attempt email=${data.email}`);
        try {
            console.log('[Auth] Sign in request for:', data.email);

            const { session, error } = await authService!.signIn(data);

            if (error || !session) {
                Sentry.addBreadcrumb({ category: 'auth', message: 'Login failed', level: 'warning' });
                logger.warn(logger.fmt`auth.login_failed email=${data.email} error=${error?.message ?? 'unknown'}`);
                console.error('[Auth] Sign in failed:', error?.message);
                appWindowManager.send('auth:state-changed', {
                    isAuthenticated: false,
                    user: null,
                    error: error?.message || 'Sign in failed',
                });
                return;
            }

            Sentry.addBreadcrumb({ category: 'auth', message: 'Login successful', level: 'info' });
            logger.info('auth.login_success via password');
            console.log('[Auth] ✅ Sign in successful');
            await handleSuccessfulAuth(appWindowManager);
        } catch (error) {
            console.error('[Auth] Unexpected sign in error:', error);
            Sentry.captureException(error);
            appWindowManager.send('auth:state-changed', {
                isAuthenticated: false,
                user: null,
                error: 'Sign in failed',
            });
        }
    });

    // Sign Out
    ipcMain.on('auth:sign-out', async () => {
        Sentry.addBreadcrumb({ category: 'auth', message: 'Sign out', level: 'info' });
        logger.info('auth.logout');
        try {
            console.log('[Auth] Sign out request');
            await authService!.signOut();

            authState.isAuthenticated = false;
            authState.currentUserId = null;
            authState.currentUserEmail = null;
            Sentry.setUser(null);
            appWindowManager.send('sentry:set-user', null);

            console.log('[Auth] ✅ User signed out');

            appWindowManager.send('auth:state-changed', {
                isAuthenticated: false,
                user: null
            });
        } catch (error) {
            console.error('[Auth] Error signing out:', error);
            Sentry.captureException(error);
        }
    });

    // App Window: Sign Out (Legacy/System Tray)
    ipcMain.on('app:sign-out', async () => {
        Sentry.addBreadcrumb({ category: 'auth', message: 'Sign out', level: 'info' });
        logger.info('auth.logout via app:sign-out');
        try {
            console.log('[Auth] Sign out request (app:sign-out)');
            await authService!.signOut();

            authState.isAuthenticated = false;
            authState.currentUserId = null;
            authState.currentUserEmail = null;
            Sentry.setUser(null);
            appWindowManager.send('sentry:set-user', null);

            console.log('[Auth] ✅ User signed out');

            appWindowManager.send('auth:state-changed', {
                isAuthenticated: false,
                user: null
            });
        } catch (error) {
            console.error('[Auth] Error signing out:', error);
            Sentry.captureException(error);
        }
    });

    // OAuth Sign In (Google / GitHub) — localhost HTTP callback server
    // Uses port 0 so the OS assigns a free port — no fixed-port conflicts ever.
    ipcMain.handle('auth:oauth-sign-in', async (_event, { provider }: { provider: 'google' | 'github' }) => {
        Sentry.addBreadcrumb({ category: 'auth', message: `OAuth started: ${provider}`, level: 'info' });
        logger.info(logger.fmt`auth.oauth_started provider=${provider}`);
        try {
            await new Promise<void>((resolve, reject) => {
                // ── Timeout: auto-close server after 10 minutes ──────────────
                let serverClosed = false;
                const closeServer = () => {
                    if (!serverClosed) {
                        serverClosed = true;
                        server.close();
                    }
                };
                const timeout = setTimeout(() => {
                    closeServer();
                    reject(new Error('OAuth sign-in timed out'));
                }, 10 * 60 * 1000);

                // ── Temporary HTTP server to receive the OAuth code ──────────
                const server = http.createServer(async (req, res) => {
                    // Determine the actual port the OS assigned
                    const actualPort = (server.address() as { port: number } | null)?.port ?? 0;
                    try {
                        const reqUrl = new URL(req.url!, `http://127.0.0.1:${actualPort}`);
                        if (reqUrl.pathname !== '/auth/callback') {
                            res.writeHead(404); res.end(); return;
                        }

                        const code  = reqUrl.searchParams.get('code');
                        const oauthError = reqUrl.searchParams.get('error');

                        // Respond with a friendly HTML page before doing async work
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        if (code) {
                            res.end(`<!DOCTYPE html><html><head><title>Signed in — Prmpt</title>
                              <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}
                              .card{text-align:center;padding:40px;max-width:360px}.icon{font-size:48px;margin-bottom:16px}.title{font-size:22px;font-weight:600;margin-bottom:8px}
                              .sub{color:#888;font-size:14px}</style></head>
                              <body><div class="card"><div class="icon">✅</div>
                              <div class="title">Sign in successful!</div>
                              <div class="sub">You can close this tab and return to Prmpt.</div>
                              </div><script>setTimeout(()=>window.close(),2500)</script></body></html>`);
                        } else {
                            res.end(`<!DOCTYPE html><html><head><title>Sign in failed — Prmpt</title>
                              <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}
                              .card{text-align:center;padding:40px;max-width:360px}.icon{font-size:48px;margin-bottom:16px}.title{font-size:22px;font-weight:600;margin-bottom:8px}
                              .sub{color:#888;font-size:14px}</style></head>
                              <body><div class="card"><div class="icon">❌</div>
                              <div class="title">Sign in failed</div>
                              <div class="sub">${oauthError || 'No authorization code received.'}</div>
                              </div></body></html>`);
                        }

                        clearTimeout(timeout);
                        closeServer();

                        if (code) {
                            const { session, error: sessionError } = await authService!.exchangeCodeForSession(code);
                            if (sessionError || !session) {
                                logger.warn(logger.fmt`auth.oauth_exchange_failed provider=${provider} error=${sessionError?.message ?? 'unknown'}`);
                                Sentry.addBreadcrumb({ category: 'auth', message: `OAuth exchange failed: ${provider}`, level: 'warning' });
                                console.error('[Auth] OAuth code exchange failed:', sessionError?.message);
                                appWindowManager.send('auth:state-changed', {
                                    isAuthenticated: false, user: null,
                                    error: sessionError?.message || 'OAuth sign-in failed',
                                });
                                return;
                            }
                            logger.info(logger.fmt`auth.oauth_success provider=${provider} userId=${session.user.id}`);
                            Sentry.addBreadcrumb({ category: 'auth', message: `OAuth success: ${provider}`, level: 'info' });
                            console.log(`[Auth] ✅ OAuth sign-in successful (${provider})`);
                            appWindowManager.show();
                            await handleSuccessfulAuth(appWindowManager, session.user);
                        } else if (oauthError) {
                            logger.warn(logger.fmt`auth.oauth_error provider=${provider} error=${oauthError}`);
                            Sentry.addBreadcrumb({ category: 'auth', message: `OAuth error: ${provider}`, level: 'warning' });
                            appWindowManager.send('auth:state-changed', {
                                isAuthenticated: false, user: null,
                                error: `OAuth error: ${oauthError}`,
                            });
                        }
                    } catch (err) {
                        logger.error(logger.fmt`auth.oauth_callback_error provider=${provider}`);
                        console.error('[Auth] OAuth callback handler error:', err);
                        Sentry.captureException(err);
                        res.writeHead(500); res.end();
                        clearTimeout(timeout);
                        closeServer();
                    }
                });

                server.on('error', (err: NodeJS.ErrnoException) => {
                    Sentry.captureException(err);
                    clearTimeout(timeout);
                    reject(err);
                });

                // Bind to port 0 → OS picks any free port
                server.listen(0, '127.0.0.1', async () => {
                    const actualPort = (server.address() as { port: number }).port;
                    const redirectTo = `http://127.0.0.1:${actualPort}/auth/callback`;
                    try {
                        const { url, error } = await authService!.signInWithOAuth(provider, redirectTo);
                        if (error || !url) {
                            closeServer();
                            clearTimeout(timeout);
                            reject(new Error(error?.message || 'Failed to generate OAuth URL'));
                            return;
                        }
                        await shell.openExternal(url);
                        console.log(`[Auth] ✅ OAuth flow started for ${provider} — callback on port ${actualPort}`);
                        resolve(); // Resolve as soon as the browser is opened
                    } catch (err) {
                        closeServer();
                        clearTimeout(timeout);
                        reject(err);
                    }
                });
            });

            return { success: true };
        } catch (err: any) {
            console.error('[Auth] OAuth sign-in failed:', err.message);
            Sentry.captureException(err);
            return { error: err.message || 'OAuth sign-in failed' };
        }
    });

    // Check Auth Status
    ipcMain.on('auth:check', async () => {
        try {
            console.log('[Auth] 📥 Renderer requested auth check');

            // getSession() reads from the local filesystem session.json — works offline
            const { authService } = getServices();
            const { session, error } = await authService.getSession();

            if (error || !session) {
                console.log('[Auth] No valid session found');
                authState.isAuthenticated = false;
                authState.currentUserId = null;
                appWindowManager.send('auth:state-changed', { isAuthenticated: false, user: null });
                return;
            }

            // Set auth state from local session (no network needed for this)
            authState.isAuthenticated = true;
            authState.currentUserId = session.user.id;
            console.log('[Auth] ✅ Valid session found, user authenticated (offline-safe)');

            // If checkAndRestoreSession already ran handleSuccessfulAuth on startup,
            // skip the full data-load to avoid redundant Supabase calls.
            // We still call handleSuccessfulAuth if it hasn't been run yet (edge case).
            await handleSuccessfulAuth(appWindowManager, session.user);
        } catch (error) {
            console.error('[Auth] Error checking auth:', error);
            Sentry.captureException(error);
            appWindowManager.send('auth:state-changed', {
                isAuthenticated: false,
                user: null,
                error: 'Auth check failed',
            });
        }
    });
}

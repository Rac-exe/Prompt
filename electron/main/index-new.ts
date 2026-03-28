import * as dotenv from 'dotenv';
dotenv.config();

import * as Sentry from '@sentry/electron/main';
import { logger } from '@sentry/core';

const appVersion = require('../../package.json').version;

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: `prmpt@${appVersion}`,
  environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.2,
  _experiments: { enableLogs: true },
  beforeSend(event) {
    const PII_RE = /prompt|content|message|text/i;
    if (event.extra) {
      for (const key of Object.keys(event.extra)) {
        if (PII_RE.test(key)) event.extra[key] = '[REDACTED]';
      }
    }
    if (event.breadcrumbs) {
      for (const bc of event.breadcrumbs) {
        if (bc.data) {
          for (const key of Object.keys(bc.data)) {
            if (PII_RE.test(key)) (bc.data as Record<string, unknown>)[key] = '[REDACTED]';
          }
        }
      }
    }
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value && PII_RE.test(ex.value)) ex.value = '[REDACTED]';
        for (const frame of ex.stacktrace?.frames ?? []) {
          if (frame.vars) {
            for (const key of Object.keys(frame.vars)) {
              if (PII_RE.test(key)) frame.vars[key] = '[REDACTED]';
            }
          }
        }
      }
    }
    return event;
  },
});

import { app, globalShortcut, ipcMain, shell } from 'electron';
import { AppWindowManager } from './windows/app-window-manager';
import { OverlayWindowManager } from './overlay/overlay-window-manager';
import { SystemTray } from './windows/system-tray';
import { PythonClient } from './api/python-client';
import { TranscriptionClient } from './api/transcription-client';
import { SupabaseClientManager } from './database/supabase-client';
import { ChatService } from './database/services/chat-service';
import { OptimizationService } from './database/services/optimization-service';
import { UserService } from './database/services/user-service';
import { AuthService } from './database/services/auth-service';
import { SettingsService } from './database/services/settings-service';
import { PromptLibraryService } from './database/services/prompt-library-service';
import { authState } from './utils/auth-state';
import { registerAuthHandlers, checkAndRestoreSession } from './ipc-handlers/auth-handlers';
import { registerSettingsHandlers } from './ipc-handlers/settings-handlers';
import { registerUserHandlers } from './ipc-handlers/user-handlers';
import { registerChatHandlers } from './ipc-handlers/chat-handlers';
import { registerOverlayHandlers } from './ipc-handlers/overlay-ipc-handlers';
import { registerSkillHandlers } from './ipc-handlers/skill-handlers';
import { startHook, stopHook, isNativeBridgeAvailable, TriggerAnchor } from './utils/native-bridge';
import { registerAvatarHandlers } from './ipc-handlers/avatar-handlers';
import { registerFileUploadHandlers } from './ipc-handlers/file-upload-service';
import { registerFeedbackHandlers } from './ipc-handlers/feedback-handlers';

// Import modular IPC handlers (these auto-register on import)
import './ipc-handlers/prompt-library-handlers';
import { syncOfflineQueue } from './ipc-handlers/prompt-library-handlers';
import { syncChatMessageQueue } from './ipc-handlers/chat-handlers';
import { networkMonitor } from './ipc-handlers/network-monitor-singleton';
let appWindowManager: AppWindowManager;
let overlayManager: OverlayWindowManager;
let systemTray: SystemTray;
let pythonClient: PythonClient;
let transcriptionClient: TranscriptionClient;


// ============================================
// KEYSTROKE DETECTION (Rust native bridge)
// ============================================
function startKeystrokeDetection() {
  if (!isNativeBridgeAvailable()) {
    console.warn('[Main] Native bridge not available — @prompt hook disabled. Run: npm run native:build');
    return;
  }

  startHook((anchor: TriggerAnchor) => {
    console.log(`[Main] @prompt detected — hwnd=${anchor.hwnd}, triggerLen=${anchor.triggerLen}`);
    Sentry.addBreadcrumb({ category: 'hook', message: '@prompt detected', level: 'info', data: { hwnd: anchor.hwnd } });
    overlayManager.open(authState.isAuthenticated, undefined, undefined, true,
      authState.currentUserId ? { id: authState.currentUserId, email: authState.currentUserEmail ?? '' } : null);
  });

  console.log('[Main] Native keyboard hook started');
}

function stopKeystrokeDetection() {
  stopHook();
}

// ============================================
// OVERLAY CONTROL
// ============================================
function toggleOverlay() {
  const sentryUser = authState.currentUserId
    ? { id: authState.currentUserId, email: authState.currentUserEmail ?? '' }
    : null;
  Sentry.addBreadcrumb({ category: 'overlay', message: 'Overlay toggled', level: 'info', data: { isAuthenticated: authState.isAuthenticated } });
  overlayManager.toggle(authState.isAuthenticated, sentryUser);
}

// ============================================
// INITIALIZATION
// ============================================
async function initialize() {
  console.log('[Main] Initializing Prompt Optimizer...');

  // Initialize Supabase
  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[Main] ERROR: Supabase credentials not found!');
    console.error('[Main] Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables');
    Sentry.captureMessage('App failed to start: SUPABASE_URL or SUPABASE_ANON_KEY missing', 'fatal');
    await Sentry.flush(2000);
    return;
  }

  SupabaseClientManager.initialize(SUPABASE_URL, SUPABASE_KEY);

  // Create app window manager and preload it (hidden) for instant first open
  appWindowManager = new AppWindowManager();
  appWindowManager.preload();

  // Create overlay manager (pre-load hidden window for instant open)
  overlayManager = new OverlayWindowManager();
  overlayManager.preload();

  // Initialize Python client
  pythonClient = new PythonClient('http://127.0.0.1:8001');

  let pythonHealthy = false;
  try {
    const isHealthy = await pythonClient.healthCheck();
    pythonHealthy = isHealthy;
    if (isHealthy) {
      console.log('[Main] Python service connected');
      pythonClient.connect().catch(e => console.error('[Main] Background connect error:', e));
    } else {
      console.warn('[Main] Python service not available');
    }
  } catch (error) {
    console.warn('[Main] Could not connect to Python service');
    Sentry.captureException(error, { level: 'warning', tags: { component: 'python-init' } });
  }

  // Background health-check loop — detects Python crashes mid-session
  const HEALTH_CHECK_INTERVAL_MS = 30_000;
  setInterval(async () => {
    try {
      const healthy = await pythonClient.healthCheck();
      if (!healthy && pythonHealthy) {
        pythonHealthy = false;
        appWindowManager.send('python:unavailable', {});
        overlayManager.send('python:unavailable', {});
        console.warn('[Main] Python service became unavailable');
        Sentry.addBreadcrumb({ category: 'python', message: 'Python service became unavailable', level: 'warning' });
        Sentry.captureMessage('Python service became unavailable', 'warning');
      } else if (healthy && !pythonHealthy) {
        pythonHealthy = true;
        appWindowManager.send('python:recovered', {});
        overlayManager.send('python:recovered', {});
        console.log('[Main] Python service recovered');
        Sentry.addBreadcrumb({ category: 'python', message: 'Python service recovered', level: 'info' });
      }
    } catch (healthErr) {
      if (pythonHealthy) {
        pythonHealthy = false;
        appWindowManager.send('python:unavailable', {});
        overlayManager.send('python:unavailable', {});
        console.warn('[Main] Python health check failed');
        Sentry.addBreadcrumb({ category: 'python', message: 'Python health check failed', level: 'warning' });
        Sentry.captureMessage('Python health check failed', 'warning');
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  // Start network monitor — broadcasts online/offline status to all windows
  networkMonitor.start(
    (channel, data) => appWindowManager.send(channel, data),
    (channel, data) => overlayManager.send(channel, data),
    () => {
      // Reconnected: notify renderer, then drain the offline queue
      appWindowManager.send('network:reconnected', {});
      syncOfflineQueue((ch, data) => appWindowManager.send(ch, data))
        .catch(e => {
          console.error('[Main] Prompt-library offline sync failed:', e);
          Sentry.captureException(e, { tags: { component: 'offline-sync-prompt-library' } });
        });
      syncChatMessageQueue(appWindowManager, pythonClient)
        .catch(e => {
          console.error('[Main] Chat message offline sync failed:', e);
          Sentry.captureException(e, { tags: { component: 'offline-sync-chat' } });
        });
    }
  );
  console.log('[Main] NetworkMonitor started');

  // Initialize Transcription client
  transcriptionClient = new TranscriptionClient('ws://127.0.0.1:8001');
  console.log('[Main] Transcription client initialized');

  // ============================================
  // TRANSCRIPTION IPC HANDLERS
  // ============================================
  ipcMain.on('transcription:start', async (event, sessionId: string) => {
    Sentry.addBreadcrumb({ category: 'transcription', message: 'Transcription started', level: 'info', data: { sessionId } });
    logger.info(logger.fmt`transcription.started sessionId=${sessionId}`);
    try {
      console.log('[Main] Starting transcription session:', sessionId);

      await transcriptionClient.startTranscription(
        sessionId,
        // onTranscription — live chunks + final result
        (data) => {
          overlayManager.send('transcription:update', data);
          appWindowManager.send('transcription:update', data);
        },
        // onError
        (error) => {
          console.error('[Main] Transcription error:', error);
          overlayManager.send('transcription:error', error);
          appWindowManager.send('transcription:error', error);
        },
        // onStatus — 'listening' | 'processing' | 'stopped'
        (status) => {
          console.log('[Main] Transcription status:', status);
          overlayManager.send('transcription:status', status);
          appWindowManager.send('transcription:status', status);
        },
      );
    } catch (error) {
      Sentry.addBreadcrumb({ category: 'transcription', message: 'Transcription error', level: 'error' });
      Sentry.captureException(error);
      logger.error(logger.fmt`transcription.error ${error instanceof Error ? error.message : String(error)}`);
      console.error('[Main] Failed to start transcription:', error);
      overlayManager.send('transcription:error', error instanceof Error ? error.message : 'Failed to start');
      appWindowManager.send('transcription:error', error instanceof Error ? error.message : 'Failed to start');
    }
  });

  ipcMain.on('transcription:stop', async () => {
    Sentry.addBreadcrumb({ category: 'transcription', message: 'Transcription stopped', level: 'info' });
    logger.info('transcription.stopped');
    try {
      console.log('[Main] Stopping transcription');
      await transcriptionClient.stopTranscription();
    } catch (error) {
      Sentry.captureException(error);
      console.error('[Main] Failed to stop transcription:', error);
    }
  });

  // ============================================
  // REGISTER IPC HANDLERS
  // ============================================
  registerAuthHandlers(appWindowManager);
  registerUserHandlers(appWindowManager);
  registerSettingsHandlers(overlayManager);
  registerChatHandlers(appWindowManager, pythonClient);
  registerOverlayHandlers(overlayManager, pythonClient, appWindowManager);
  registerSkillHandlers();
  registerAvatarHandlers();
  registerFileUploadHandlers();
  registerFeedbackHandlers();

  // ============================================
  // WINDOW CONTROL IPC HANDLERS (frameless window)
  // ============================================
  ipcMain.on('shell:openExternal', (_event, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.on('window:minimize', () => {
    const win = appWindowManager.getWindow();
    if (win && !win.isDestroyed()) win.minimize();
  });

  ipcMain.on('window:maximize', () => {
    const win = appWindowManager.getWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    const win = appWindowManager.getWindow();
    if (win && !win.isDestroyed()) win.hide();
  });

  // ============================================
  // SESSION MANAGEMENT & AUTH STATE SYNC
  // ============================================
  try {
    const authService = new AuthService();
    const hasSession = await checkAndRestoreSession(appWindowManager);

    if (hasSession) {
      console.log('[Main] Session restored, user logged in');
    } else {
      console.log('[Main] No session found, user needs to log in');
    }

    // Listen for auth state changes and sync to overlay
    authService.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        authState.isAuthenticated = true;
        authState.currentUserId = session.user.id;
        authState.currentUserEmail = session.user.email ?? null;
        Sentry.setUser({ id: session.user.id });
        overlayManager.sendAuthState(true);
      } else if (event === 'SIGNED_OUT') {
        // Guard: if we're offline, this SIGNED_OUT is Supabase's internal JWT
        // refresh poller failing due to no network — NOT a real sign-out.
        // Ignore it so the offline session remains valid.
        if (!networkMonitor.isOnline) {
          console.warn('[Main] Ignoring SIGNED_OUT — device is offline (spurious token refresh failure)');
          return;
        }

        authState.isAuthenticated = false;
        authState.currentUserId = null;
        authState.currentUserEmail = null;
        Sentry.setUser(null);
        if (appWindowManager) appWindowManager.send('sentry:set-user', null);

        if (appWindowManager) {
          appWindowManager.send('auth:state-changed', {
            isAuthenticated: false,
            user: null,
          });
        }
        overlayManager.sendAuthState(false);
      } else if (event === 'TOKEN_REFRESHED' && session) {
        console.log('[Main] Session token refreshed');
      }
    });
  } catch (error) {
    console.error('[Main] Auth initialization error:', error);
    Sentry.captureException(error, { tags: { component: 'auth-init' } });
  }

  // ============================================
  // KEYSTROKE DETECTION
  // ============================================
  startKeystrokeDetection();

  Sentry.setTag('native_bridge', isNativeBridgeAvailable() ? 'loaded' : 'stub');
  Sentry.setTag('platform', process.platform);

  // ============================================
  // GLOBAL HOTKEY: Ctrl+5 to toggle overlay
  // ============================================
  const registered = globalShortcut.register('CommandOrControl+5', () => {
    toggleOverlay();
  });

  if (registered) {
    console.log('[Main] Global hotkey registered: Ctrl+5');
  } else {
    console.error('[Main] Failed to register global hotkey');
    Sentry.captureMessage('Global hotkey Ctrl+5 registration failed', 'warning');
  }

  // ============================================
  // SYSTEM TRAY
  // ============================================
  systemTray = new SystemTray(
    () => appWindowManager.show(),  // Open app
    () => toggleOverlay(),          // Toggle overlay
    () => {
      console.log('[Main] Quit requested from tray');
      app.quit();
    }
  );
  systemTray.create();

  console.log('[Main] ========================================');
  console.log('[Main] Prompt Optimizer ready!');
  console.log('[Main] - Type @prompt anywhere to open overlay');
  console.log('[Main] - Press Ctrl+5 to toggle overlay');
  console.log('[Main] - Click tray icon to open app window');
  console.log('[Main] ========================================');

  Sentry.addBreadcrumb({ category: 'lifecycle', message: 'App startup complete', level: 'info' });
  logger.info(logger.fmt`app.startup_complete platform=${process.platform} nativeBridge=${isNativeBridgeAvailable() ? 'loaded' : 'stub'}`);
}

async function shutdown() {
  console.log('[Main] Shutting down...');
  stopKeystrokeDetection();
  globalShortcut.unregisterAll();

  // Disconnect transcription client
  if (transcriptionClient) {
    transcriptionClient.disconnect();
  }

  if (overlayManager) {
    overlayManager.destroy();
  }

  if (appWindowManager) {
    appWindowManager.destroy();
  }

  if (systemTray) {
    systemTray.destroy();
  }

  // Flush buffered Sentry events before the process exits so nothing is dropped.
  await Sentry.flush(2000);

  console.log('[Main] Shutdown complete');
}

// ============================================
// SINGLE INSTANCE LOCK (must be first, before any event listeners)
// ============================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  // ============================================
  // DEEP LINK PROTOCOL: promptweaver://share/<token>
  // ============================================
  // Register the custom protocol so the OS routes promptweaver:// URLs to us.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('promptweaver', process.execPath, [process.argv[1]]);
    }
  } else {
    app.setAsDefaultProtocolClient('promptweaver');
  }

  /**
   * Extract a share token from a protocol URL such as:
   *   promptweaver://share/abc123
   */
  function handleDeepLink(url: string): void {
    try {
      const parsed = new URL(url);

      // ── Share deep link: promptweaver://share/<token> ──────────────────────
      if (parsed.hostname === 'share') {
        const token = parsed.pathname.replace(/^\//, '');
        if (token && appWindowManager) {
          appWindowManager.show();
          const win = appWindowManager.getWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.executeJavaScript(
              `window.location.hash = '/share/${token}';`
            ).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error('[Main] Failed to handle deep link:', url, err);
      Sentry.captureException(err, { tags: { component: 'deep-link' }, extra: { url } });
    }
  }

  // macOS: open-url event fires for protocol links
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // Windows/Linux: the URL arrives as a command-line argument on second-instance
  app.on('second-instance', (_event, commandLine) => {
    if (appWindowManager) {
      appWindowManager.show();
    }
    // The last arg may be the protocol URL on Windows
    const url = commandLine.find((arg) => arg.startsWith('promptweaver://'));
    if (url) handleDeepLink(url);
  });

  // ============================================
  // APP LIFECYCLE
  // ============================================
  app.setName('Prmpt');
  if (process.platform === 'win32') {
    app.setAppUserModelId('Prmpt');
  }

  app.whenReady().then(async () => {
    // Handle protocol URL passed on startup (Windows/Linux first-launch)
    const startUrl = process.argv.find((arg) => arg.startsWith('promptweaver://'));
    if (startUrl) {
      // Defer until the window is ready
      app.once('browser-window-created', () => {
        setTimeout(() => handleDeepLink(startUrl), 1500);
      });
    }
    await initialize();
  });

  // CRITICAL: Keep running in background when all windows closed
  app.on('window-all-closed', () => {
    // Do NOT call app.quit() here!
    // The app should continue running with just the overlay and tray
  });

  app.on('activate', async () => {
    // macOS: Show app window when dock icon clicked
    if (appWindowManager) {
      appWindowManager.show();
    }
  });

  app.on('before-quit', async () => {
    await shutdown();
  });

  app.on('will-quit', () => {
    if (app.isReady()) {
      globalShortcut.unregisterAll();
    }
  });
}

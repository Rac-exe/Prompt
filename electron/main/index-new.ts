import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// In dev mode, .env lives at the project root (2 levels above dist/main/).
// In a packaged app, the project root doesn't exist — load from extraResources.
const _devEnvPath = path.join(__dirname, '..', '..', '.env');
dotenv.config({ path: fs.existsSync(_devEnvPath) ? _devEnvPath : path.join(process.resourcesPath, '.env') });

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

import { app, globalShortcut, ipcMain, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
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
import { registerDeletionHandlers } from './ipc-handlers/deletion-handlers';
import { analyticsService } from './analytics/analytics-service';

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

function getPythonHttpBaseUrl(): string {
  const raw = (process.env.PYTHON_SERVICE_URL || '').trim();
  if (!raw) return 'http://127.0.0.1:8001';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // Ignore malformed values and fall back to localhost.
  }
  console.warn('[Main] Invalid PYTHON_SERVICE_URL — falling back to http://127.0.0.1:8001');
  return 'http://127.0.0.1:8001';
}

function toWsBaseUrl(httpBaseUrl: string): string {
  return httpBaseUrl.startsWith('https://')
    ? httpBaseUrl.replace('https://', 'wss://')
    : httpBaseUrl.replace('http://', 'ws://');
}


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
// AUTO-UPDATER
// ============================================
function setupAutoUpdater() {
  // In dev mode there's nothing to update — bail silently.
  if (!app.isPackaged) {
    console.log('[Updater] Skipping auto-update — not a packaged build.');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  Sentry.setTag('updater', 'enabled');
  logger.info('updater.initialized autoDownload=true autoInstallOnAppQuit=true');

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
    Sentry.addBreadcrumb({
      category: 'updater',
      message: 'Checking for update',
      level: 'info',
      data: { currentVersion: app.getVersion() },
    });
    logger.info(logger.fmt`updater.checking currentVersion=${app.getVersion()}`);
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] Update available: ${info.version}`);
    Sentry.addBreadcrumb({
      category: 'updater',
      message: 'Update available',
      level: 'info',
      data: { currentVersion: app.getVersion(), newVersion: info.version, releaseDate: info.releaseDate },
    });
    Sentry.setTag('update_available', info.version);
    logger.info(logger.fmt`updater.update_available newVersion=${info.version} currentVersion=${app.getVersion()}`);
    appWindowManager?.send('update:available', { version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] App is up to date.');
    Sentry.addBreadcrumb({
      category: 'updater',
      message: 'App is up to date',
      level: 'info',
      data: { currentVersion: app.getVersion(), latestVersion: info.version },
    });
    logger.info(logger.fmt`updater.up_to_date version=${app.getVersion()}`);
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    console.log(`[Updater] Download progress: ${percent}%`);
    Sentry.addBreadcrumb({
      category: 'updater',
      message: `Download progress: ${percent}%`,
      level: 'info',
      data: {
        percent,
        bytesPerSecond: Math.round(progress.bytesPerSecond),
        transferred: progress.transferred,
        total: progress.total,
      },
    });
    appWindowManager?.send('update:progress', {
      percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] Update downloaded: ${info.version}`);
    Sentry.addBreadcrumb({
      category: 'updater',
      message: 'Update downloaded — ready to install',
      level: 'info',
      data: { version: info.version, releaseDate: info.releaseDate },
    });
    Sentry.setTag('update_downloaded', info.version);
    logger.info(logger.fmt`updater.downloaded version=${info.version}`);
    appWindowManager?.send('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    Sentry.captureException(err, {
      level: 'warning',
      tags: { component: 'auto-updater' },
      extra: { currentVersion: app.getVersion() },
    });
    logger.error(logger.fmt`updater.error ${err.message}`);
  });

  // Check 5 seconds after launch so the window is ready, then every 4 hours.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      Sentry.captureException(err, { level: 'warning', tags: { component: 'auto-updater', trigger: 'startup-check' } });
    });
  }, 5_000);

  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      Sentry.captureException(err, { level: 'warning', tags: { component: 'auto-updater', trigger: 'interval-check' } });
    });
  }, 4 * 60 * 60 * 1_000);
}

// IPC: renderer asks us to quit and install the downloaded update.
ipcMain.on('update:install', () => {
  Sentry.addBreadcrumb({
    category: 'updater',
    message: 'User triggered quit-and-install',
    level: 'info',
    data: { currentVersion: app.getVersion() },
  });
  logger.info(logger.fmt`updater.install_triggered version=${app.getVersion()}`);
  Sentry.flush(2000).then(() => autoUpdater.quitAndInstall(false, true));
});

// ============================================
// INITIALIZATION
// ============================================
function installCSP() {
  const supabaseHost = (process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '');
  const pythonHttpBase = getPythonHttpBaseUrl();
  const pythonWsBase = toWsBaseUrl(pythonHttpBase);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            `img-src 'self' data: https: blob:`,
            `font-src 'self' data:`,
            `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} ${pythonHttpBase} ${pythonWsBase} https://*.sentry.io https://res.cloudinary.com`,
            `media-src 'self' blob:`,
          ].join('; '),
        ],
      },
    });
  });
}

async function initialize() {
  installCSP();
  console.log('[Main] Initializing Prompt Optimizer...');
  const pythonHttpBase = getPythonHttpBaseUrl();
  const pythonWsBase = toWsBaseUrl(pythonHttpBase);
  console.log(`[Main] Python service URL: ${pythonHttpBase}`);

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

  // Create managers and clients (no windows loaded yet)
  appWindowManager = new AppWindowManager();
  overlayManager = new OverlayWindowManager();
  pythonClient = new PythonClient(pythonHttpBase);
  transcriptionClient = new TranscriptionClient(pythonWsBase);
  console.log('[Main] Transcription client initialized');

  // ============================================
  // REGISTER ALL IPC HANDLERS BEFORE WINDOW PRELOAD
  // ============================================
  // Handlers must be registered before windows load HTML, otherwise the
  // renderer fires IPC calls (overlay:get-settings, skills:list, etc.)
  // before handlers exist — causing silent failures on first attempt.
  registerAuthHandlers(appWindowManager);
  registerUserHandlers(appWindowManager);
  registerSettingsHandlers(overlayManager);
  registerChatHandlers(appWindowManager, pythonClient);
  registerOverlayHandlers(overlayManager, pythonClient, appWindowManager);
  registerSkillHandlers();
  registerAvatarHandlers(pythonClient);
  registerFileUploadHandlers();
  registerFeedbackHandlers();
  registerDeletionHandlers();

  // Transcription IPC handlers (inline — depend on transcriptionClient)
  ipcMain.on('transcription:debug', (_event, msg: string) => {
    console.log(`[Preload] ${msg}`);
  });

  let activeTranscriptionSpan: { finish: () => void } | null = null;

  ipcMain.on('transcription:start', async (_event, config: { sessionId: string; sampleRate: number }) => {
    const { sessionId, sampleRate } = config;
    Sentry.addBreadcrumb({ category: 'transcription', message: 'Transcription started', level: 'info', data: { sessionId, sampleRate } });
    logger.info(logger.fmt`transcription.started sessionId=${sessionId} sampleRate=${sampleRate}`);

    await Sentry.startSpan(
      { name: 'voice-transcription', op: 'transcription.session', attributes: { sessionId, sampleRate } },
      async (span) => {
        activeTranscriptionSpan = { finish: () => span.end() };
        try {
          console.log('[Main] Starting streaming transcription session:', sessionId, 'rate:', sampleRate);

          await transcriptionClient.startSession(sessionId, sampleRate, {
            onTranscription: (data) => {
              try { overlayManager.send('transcription:update', data); } catch (_) {}
              try { appWindowManager.send('transcription:update', data); } catch (_) {}
            },
            onError: (error) => {
              console.error('[Main] Transcription error:', error);
              Sentry.addBreadcrumb({ category: 'transcription', message: 'Transcription error forwarded to renderer', level: 'error', data: { error, sessionId } });
              try { overlayManager.send('transcription:error', error); } catch (_) {}
              try { appWindowManager.send('transcription:error', error); } catch (_) {}
            },
            onStatus: (status) => {
              console.log('[Main] Transcription status:', status);
              Sentry.addBreadcrumb({ category: 'transcription', message: `Transcription status: ${status}`, level: 'info', data: { status, sessionId } });
              try { overlayManager.send('transcription:status', status); } catch (_) {}
              try { appWindowManager.send('transcription:status', status); } catch (_) {}
            },
          });
        } catch (error) {
          Sentry.captureException(error, { tags: { component: 'transcription-ipc', sessionId } });
          logger.error(logger.fmt`transcription.error ${error instanceof Error ? error.message : String(error)}`);
          console.error('[Main] Failed to start transcription:', error);
          try { overlayManager.send('transcription:error', error instanceof Error ? error.message : 'Failed to start'); } catch (_) {}
          try { appWindowManager.send('transcription:error', error instanceof Error ? error.message : 'Failed to start'); } catch (_) {}
          activeTranscriptionSpan = null;
        }
      },
    );
  });

  ipcMain.on('transcription:audio-chunk', (_event, chunk: any) => {
    transcriptionClient.sendAudioChunk(Buffer.from(chunk));
  });

  ipcMain.on('transcription:stop', async () => {
    Sentry.addBreadcrumb({ category: 'transcription', message: 'Transcription stop requested', level: 'info' });
    logger.info('transcription.stopped');
    try {
      console.log('[Main] Stopping transcription');
      await transcriptionClient.stopSession();
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'transcription-ipc' } });
      console.error('[Main] Failed to stop transcription:', error);
    } finally {
      if (activeTranscriptionSpan) {
        activeTranscriptionSpan.finish();
        activeTranscriptionSpan = null;
      }
    }
  });

  // ============================================
  // NOW preload windows — renderer can safely call any IPC handler
  // ============================================
  appWindowManager.preload();
  overlayManager.preload();

  // Fire WebSocket connection in the background — wakes up Render and absorbs
  // cold-start latency before the user sends their first prompt.
  pythonClient.connect().catch(e => console.error('[Main] Background connect error:', e));

  let pythonHealthy = false;
  try {
    const isHealthy = await pythonClient.healthCheck();
    pythonHealthy = isHealthy;
    if (isHealthy) {
      console.log('[Main] Python service connected');
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

  // ============================================
  // WINDOW CONTROL IPC HANDLERS (frameless window)
  // ============================================
  ipcMain.on('shell:openExternal', (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        console.warn(`[Security] Blocked openExternal — disallowed protocol: ${parsed.protocol}`);
        return;
      }
      shell.openExternal(url);
    } catch {
      console.warn(`[Security] Blocked openExternal — invalid URL: ${url}`);
    }
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

  // Show the main window immediately — auth resolves in the background
  // so the user sees the loading spinner within ~2s instead of ~10s.
  appWindowManager.show();

  console.log('[Main] ========================================');
  console.log('[Main] Prompt Optimizer ready!');
  console.log('[Main] - Type @prompt anywhere to open overlay');
  console.log('[Main] - Press Ctrl+5 to toggle overlay');
  console.log('[Main] - Click tray icon to open app window');
  console.log('[Main] ========================================');

  // ============================================
  // SESSION MANAGEMENT & AUTH STATE SYNC
  // (runs in background — window is already visible with a loading spinner)
  // ============================================

  // Set up the auth state change listener synchronously so it is active
  // before the session restore promise resolves or rejects.
  const authService = new AuthService();
  authService.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      authState.isAuthenticated = true;
      authState.currentUserId = session.user.id;
      authState.currentUserEmail = session.user.email ?? null;
      authState.currentAccessToken = session.access_token ?? null;
      Sentry.setUser({ id: session.user.id });
      Sentry.addBreadcrumb({ category: 'auth', message: 'Auth state: SIGNED_IN', level: 'info', data: { userId: session.user.id } });
      overlayManager.sendAuthState(true);

      analyticsService.initialize(session.user.id);
      analyticsService.startSession(appVersion).catch(() => {});
    } else if (event === 'SIGNED_OUT') {
      if (!networkMonitor.isOnline) {
        console.warn('[Main] Ignoring SIGNED_OUT — device is offline (spurious token refresh failure)');
        Sentry.addBreadcrumb({ category: 'auth', message: 'Ignored spurious SIGNED_OUT (offline)', level: 'warning' });
        return;
      }

      authState.isAuthenticated = false;
      authState.currentUserId = null;
      authState.currentUserEmail = null;
      authState.currentAccessToken = null;
      Sentry.setUser(null);
      Sentry.addBreadcrumb({ category: 'auth', message: 'Auth state: SIGNED_OUT', level: 'info' });
      if (appWindowManager) appWindowManager.send('sentry:set-user', null);

      if (appWindowManager) {
        appWindowManager.send('auth:state-changed', {
          isAuthenticated: false,
          user: null,
        });
      }
      overlayManager.sendAuthState(false);
    } else if (event === 'TOKEN_REFRESHED' && session) {
      console.log('[Main] Session token refreshed — updating auth state');
      authState.currentAccessToken = session.access_token ?? null;
      Sentry.addBreadcrumb({ category: 'auth', message: 'Token refreshed', level: 'info' });
      pythonClient.reconnect();
    }
  });

  // Fire session restore without blocking — sends auth:state-changed when done,
  // which moves the UI from the loading spinner to the authenticated app view.
  checkAndRestoreSession(appWindowManager)
    .then(hasSession => {
      Sentry.addBreadcrumb({ category: 'auth', message: 'Session restore complete', level: 'info', data: { hasSession } });
      if (hasSession) {
        console.log('[Main] Session restored, user logged in');
        overlayManager.sendAuthState(true);

        if (authState.currentUserId) {
          analyticsService.initialize(authState.currentUserId);
          analyticsService.startSession(appVersion).catch(() => {});
        }
      } else {
        console.log('[Main] No session found, user needs to log in');
      }
    })
    .catch(err => {
      console.error('[Main] Auth initialization error:', err);
      Sentry.captureException(err, { tags: { component: 'auth-init' } });
    });

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

  // Flush analytics events and close the session before Sentry flushes.
  await analyticsService.shutdown();

  // Flush buffered Sentry events before the process exits so nothing is dropped.
  await Sentry.flush(2000);

  console.log('[Main] Shutdown complete');
}

// ============================================
// GLOBAL ERROR GUARDS — prevent silent crashes in Electron main process
// ============================================
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  Sentry.captureException(err, { tags: { source: 'unhandledRejection' } });
  console.error('[Main] Unhandled promise rejection (captured, process continues):', err.message);
});

process.on('uncaughtException', (err) => {
  Sentry.captureException(err, { tags: { source: 'uncaughtException' } });
  console.error('[Main] Uncaught exception:', err.message);
  // Do NOT call process.exit — let Electron handle it via its own crash reporter
});

// ============================================
// SINGLE INSTANCE LOCK (must be first, before any event listeners)
// ============================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  // ============================================
  // DEEP LINK PROTOCOL: prmpt://share/<type>/<token>
  // ============================================
  // Register the custom protocol so the OS routes prmpt:// URLs to us.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('prmpt', process.execPath, [process.argv[1]]);
    }
  } else {
    app.setAsDefaultProtocolClient('prmpt');
  }

  /**
   * Token validation regex: base64url characters only, 20–50 chars.
   * Matches randomBytes(24).toString('base64url') output (32 chars).
   * Bounded length prevents oversized input abuse.
   */
  const VALID_SHARE_TOKEN = /^[A-Za-z0-9_-]{20,50}$/;

  /**
   * Hard-whitelisted path prefixes → React Router route prefixes.
   * "c" = collection (app-only), "p" = prompt (app deep-link).
   * Anything not in this map is silently discarded.
   */
  const SHARE_PATH_MAP: Record<string, string> = {
    c: '/share/c',
    p: '/share/p',
  };

  /**
   * Handle a prmpt:// deep link URL.
   * Expected shape: prmpt://share/<c|p>/<hmac_token>
   * Sends the validated route path to the renderer via navigate-to-share.
   */
  function handleDeepLink(url: string): void {
    try {
      const parsed = new URL(url);
      Sentry.addBreadcrumb({
        category: 'sharing',
        message: 'Deep link received',
        level: 'info',
        data: {
          protocol: parsed.protocol,
          host: parsed.hostname,
          pathLength: parsed.pathname.length,
        },
      });

      // Only handle prmpt:// share links
      if (parsed.protocol !== 'prmpt:' || parsed.hostname !== 'share') return;

      // pathname = "/<type>/<token>" — strip leading slash then split
      const parts = parsed.pathname.replace(/^\//, '').split('/');
      if (parts.length !== 2) return;

      const [typePrefix, token] = parts;
      const routeBase = SHARE_PATH_MAP[typePrefix];

      // Hard-whitelist check + token format validation
      if (!routeBase || !VALID_SHARE_TOKEN.test(token)) return;

      if (appWindowManager) {
        appWindowManager.show();
        const win = appWindowManager.getWindow();
        if (win && !win.isDestroyed()) {
          Sentry.addBreadcrumb({
            category: 'sharing',
            message: 'Deep link routed to renderer',
            level: 'info',
            data: {
              typePrefix,
              tokenLength: token.length,
              routeBase,
            },
          });
          // Send the full route path — renderer calls navigate(routePath) directly
          win.webContents.send('navigate-to-share', `${routeBase}/${token}`);
        }
      }
    } catch (error) {
      Sentry.captureException(error, {
        level: 'warning',
        tags: { component: 'deep-link' },
        extra: { urlPrefix: typeof url === 'string' ? url.slice(0, 24) : 'unknown' },
      });
      // Swallow all errors — never let malformed URLs crash app startup flow
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
    const url = commandLine.find((arg) => arg.startsWith('prmpt://'));
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
    const startUrl = process.argv.find((arg) => arg.startsWith('prmpt://'));
    if (startUrl) {
      // Defer until the window is ready
      app.once('browser-window-created', () => {
        setTimeout(() => handleDeepLink(startUrl), 1500);
      });
    }
    await initialize();
    setupAutoUpdater();
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

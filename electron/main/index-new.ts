import { app, globalShortcut, ipcMain } from 'electron';
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
import * as dotenv from 'dotenv';
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

// Import modular IPC handlers (these auto-register on import)
import './ipc-handlers/prompt-library-handlers';
import { syncOfflineQueue } from './ipc-handlers/prompt-library-handlers';
import { networkMonitor } from './ipc-handlers/network-monitor-singleton';

// Load environment variables from .env file
dotenv.config();
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
    overlayManager.open(authState.isAuthenticated);
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
  overlayManager.toggle(authState.isAuthenticated);
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

  try {
    const isHealthy = await pythonClient.healthCheck();
    if (isHealthy) {
      console.log('[Main] Python service connected');
      pythonClient.connect().catch(e => console.error('[Main] Background connect error:', e));
    } else {
      console.warn('[Main] Python service not available');
    }
  } catch (error) {
    console.warn('[Main] Could not connect to Python service');
  }

  // Start network monitor — broadcasts online/offline status to all windows
  networkMonitor.start(
    (channel, data) => appWindowManager.send(channel, data),
    (channel, data) => overlayManager.send(channel, data),
    () => {
      // Reconnected: notify renderer, then drain the offline queue
      appWindowManager.send('network:reconnected', {});
      syncOfflineQueue((ch, data) => appWindowManager.send(ch, data))
        .catch(e => console.error('[Main] Offline sync failed:', e));
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
      console.error('[Main] Failed to start transcription:', error);
      overlayManager.send('transcription:error', error instanceof Error ? error.message : 'Failed to start');
      appWindowManager.send('transcription:error', error instanceof Error ? error.message : 'Failed to start');
    }
  });

  ipcMain.on('transcription:stop', async () => {
    try {
      console.log('[Main] Stopping transcription');
      await transcriptionClient.stopTranscription();
    } catch (error) {
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

  // ============================================
  // WINDOW CONTROL IPC HANDLERS (frameless window)
  // ============================================
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
  }

  // ============================================
  // KEYSTROKE DETECTION
  // ============================================
  startKeystrokeDetection();

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
      // hostname = "share", pathname = "/<token>"
      if (parsed.hostname === 'share') {
        const token = parsed.pathname.replace(/^\//, '');
        if (token && appWindowManager) {
          appWindowManager.show();
          // Navigate the renderer to the share page via a hash route change
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

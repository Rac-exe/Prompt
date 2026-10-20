import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// In dev mode, .env lives at the project root (2 levels above dist/main/).
// In a packaged app, the project root doesn't exist — load from extraResources.
const _devEnvPath = path.join(__dirname, '..', '..', '.env');
dotenv.config({ path: fs.existsSync(_devEnvPath) ? _devEnvPath : path.join(process.resourcesPath, '.env') });


import { app, globalShortcut, ipcMain, session, shell, systemPreferences } from 'electron';

// Optional: keep all app data in another folder (portable installs, testing).
// Must run before anything reads app.getPath('userData').
if (process.env.PRMPT_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.PRMPT_USER_DATA_DIR));
}

import { installApplicationMenu } from './menu/application-menu';
import { AppWindowManager } from './windows/app-window-manager';
import { OverlayWindowManager } from './overlay/overlay-window-manager';
import { SystemTray } from './windows/system-tray';
import { PythonClient } from './api/python-client';
import { TranscriptionClient } from './api/transcription-client';
import { closeDb, getDb } from './database/local-db';
import { authState } from './utils/auth-state';
import { registerSessionHandlers, startLocalSession } from './ipc-handlers/session-handlers';
import { registerAISettingsHandlers } from './ipc-handlers/ai-settings-handlers';
import { registerSettingsHandlers } from './ipc-handlers/settings-handlers';
import { registerUserHandlers } from './ipc-handlers/user-handlers';
import { registerChatHandlers } from './ipc-handlers/chat-handlers';
import { registerOverlayHandlers, setSourceWindow } from './ipc-handlers/overlay-ipc-handlers';
import { registerSkillHandlers } from './ipc-handlers/skill-handlers';
import { startHook, stopHook, isNativeBridgeAvailable, TriggerAnchor, getActiveWindowTitle, checkAccessibilityPermission } from './utils/native-bridge';
import { registerAvatarHandlers } from './ipc-handlers/avatar-handlers';
import { registerFileUploadHandlers } from './ipc-handlers/file-upload-service';
import { CodeIntelClient } from './api/code-intel-client';
import { registerProjectHandlers, cleanupProjectHandlers, restoreActiveProject } from './ipc-handlers/project-handlers';
import { registerSpacesBridgeHandlers } from './ipc-handlers/spaces-bridge-handlers';
import { initializeParser } from './services/code-parser';
import { setKnownProjects, startDetection, stopDetection } from './services/active-window-detector';
import {
  syncAutoLaunchOnStartup,
  getAutoLaunchPreference,
  setAutoLaunchPreference,
  applyAutoLaunchToOS,
} from './utils/auto-launch';

// Import modular IPC handlers (these auto-register on import)
import './ipc-handlers/prompt-library-handlers';
import { networkMonitor } from './ipc-handlers/network-monitor-singleton';
let appWindowManager: AppWindowManager;
let overlayManager: OverlayWindowManager;
let systemTray: SystemTray;
let pythonClient: PythonClient;
let transcriptionClient: TranscriptionClient;
let codeIntelClient: CodeIntelClient;

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
async function ensureAccessibilityPermission(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;

  if (checkAccessibilityPermission()) {
    return true;
  }

  const { dialog, shell } = require('electron');
  await dialog.showMessageBox({
    type: 'warning',
    title: 'Accessibility Permission Required',
    message: 'Prmpt needs Accessibility access to detect @prompt anywhere on your Mac.',
    detail: 'Click "Open System Settings" to grant Accessibility access to Prmpt, then return here.',
    buttons: ['Open System Settings', 'Later'],
    defaultId: 0,
  }).then((result: { response: number }) => {
    if (result.response === 0) {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
  });

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    if (checkAccessibilityPermission()) {
      console.log('[Main] Accessibility permission granted');
      return true;
    }
  }

  console.warn('[Main] Accessibility permission not granted after timeout');
  return false;
}

function startKeystrokeDetection() {
  if (!isNativeBridgeAvailable()) {
    console.warn('[Main] Native bridge not available — @prompt hook disabled. Run: npm run native:build');
    return;
  }

  if (process.platform === 'darwin') {
    ensureAccessibilityPermission().then(granted => {
      if (!granted) {
        console.warn('[Main] Accessibility permission not granted — @prompt hook disabled');
        return;
      }
      installHook();
    });
  } else {
    installHook();
  }
}

function installHook() {
  startHook((anchor: TriggerAnchor) => {
    const title = getActiveWindowTitle();
    console.log(`[Main] @prompt detected — pid=${anchor.hwnd}, triggerLen=${anchor.triggerLen}, title="${title}"`);
    setSourceWindow(anchor.hwnd, title);
    overlayManager.open(authState.isAuthenticated, undefined, undefined, true);
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
function installCSP() {
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
            `connect-src 'self' ${pythonHttpBase} ${pythonWsBase}`,
            `media-src 'self' blob:`,
            `worker-src 'self' blob:`,
          ].join('; '),
        ],
      },
    });
  });
}

function isSilentLaunch(): boolean {
  if (process.platform === 'darwin') {
    return app.getLoginItemSettings().wasOpenedAsHidden;
  }
  return process.argv.includes('--hidden');
}

async function initialize() {
  installCSP();
  console.log('[Main] Initializing Prompt Optimizer...');
  const pythonHttpBase = getPythonHttpBaseUrl();
  const pythonWsBase = toWsBaseUrl(pythonHttpBase);
  console.log(`[Main] Python service URL: ${pythonHttpBase}`);

  // Open the local database (chats, prompt library, settings, AI provider)
  getDb();
  console.log(`[Main] Data folder: ${app.getPath('userData')}`);

  // Create managers and clients (no windows loaded yet)
  appWindowManager = new AppWindowManager();
  overlayManager = new OverlayWindowManager();
  pythonClient = new PythonClient(pythonHttpBase);
  transcriptionClient = new TranscriptionClient(pythonWsBase);
  console.log('[Main] Transcription client initialized');

  // Code Intelligence Service client
  const codeIntelUrl = (process.env.CODE_INTELLIGENCE_SERVICE_URL || '').trim() || 'http://127.0.0.1:8002';
  codeIntelClient = new CodeIntelClient(codeIntelUrl);
  console.log(`[Main] Code Intelligence Service URL: ${codeIntelUrl}`);

  // ============================================
  // REGISTER ALL IPC HANDLERS BEFORE WINDOW PRELOAD
  // ============================================
  // Handlers must be registered before windows load HTML, otherwise the
  // renderer fires IPC calls (overlay:get-settings, skills:list, etc.)
  // before handlers exist — causing silent failures on first attempt.
  registerSessionHandlers(appWindowManager);
  registerAISettingsHandlers(appWindowManager, overlayManager);
  registerUserHandlers(appWindowManager);
  registerSettingsHandlers(overlayManager);
  registerChatHandlers(appWindowManager, pythonClient);
  registerOverlayHandlers(overlayManager, pythonClient, appWindowManager);
  registerSkillHandlers();
  registerAvatarHandlers();
  registerFileUploadHandlers();
  registerProjectHandlers(codeIntelClient, overlayManager, appWindowManager);
  registerSpacesBridgeHandlers(overlayManager, appWindowManager);

  // Initialize tree-sitter parser in background
  initializeParser().catch(e => console.warn('[Main] Tree-sitter init deferred:', e));

  let codeIntelProjectServicesStarted = false;
  const startCodeIntelProjectServices = async (trigger: string): Promise<void> => {
    if (codeIntelProjectServicesStarted) return;

    codeIntelProjectServicesStarted = true;
    try {
      const projects = await codeIntelClient.listProjects();
      setKnownProjects(projects);
      startDetection({
        onDetected: (project) => {
          console.log(`[Main] Auto-detected project: ${project.name}`);
          overlayManager.send('overlay:project-status', {
            projectId: project.id,
            name: project.name,
            status: project.index_status,
            auto: true,
          });
        },
        onLost: () => {
          overlayManager.send('overlay:project-status', null);
        },
      });
    } catch (e) {
      codeIntelProjectServicesStarted = false;
      console.warn('[Main] Code intelligence project detection deferred:', e);
    }

    try {
      await restoreActiveProject();
    } catch (e) {
      console.warn('[Main] Active project restore failed:', e);
    }
  };

  // Transcription IPC handlers (inline — depend on transcriptionClient)
  ipcMain.on('transcription:debug', (_event, msg: string) => {
    console.log(`[Preload] ${msg}`);
  });

  ipcMain.on('transcription:start', async (_event, config: { sessionId: string; sampleRate: number }) => {
    const { sessionId, sampleRate } = config;
    try {
      console.log('[Main] Starting streaming transcription session:', sessionId, 'rate:', sampleRate);

      await transcriptionClient.startSession(sessionId, sampleRate, {
        onTranscription: (data) => {
          try { overlayManager.send('transcription:update', data); } catch (_) {}
          try { appWindowManager.send('transcription:update', data); } catch (_) {}
        },
        onError: (error) => {
          console.error('[Main] Transcription error:', error);
          try { overlayManager.send('transcription:error', error); } catch (_) {}
          try { appWindowManager.send('transcription:error', error); } catch (_) {}
        },
        onStatus: (status) => {
          console.log('[Main] Transcription status:', status);
          try { overlayManager.send('transcription:status', status); } catch (_) {}
          try { appWindowManager.send('transcription:status', status); } catch (_) {}
        },
      });
    } catch (error) {
      console.error('[Main] Failed to start transcription:', error);
      try { overlayManager.send('transcription:error', error instanceof Error ? error.message : 'Failed to start'); } catch (_) {}
      try { appWindowManager.send('transcription:error', error instanceof Error ? error.message : 'Failed to start'); } catch (_) {}
    }
  });

  ipcMain.on('transcription:audio-chunk', (_event, chunk: any) => {
    transcriptionClient.sendAudioChunk(Buffer.from(chunk));
  });

  ipcMain.on('transcription:stop', async () => {
    try {
      console.log('[Main] Stopping transcription');
      await transcriptionClient.stopSession();
    } catch (error) {
      console.error('[Main] Failed to stop transcription:', error);
    }
  });

  // ============================================
  // NOW preload windows — renderer can safely call any IPC handler
  // ============================================
  appWindowManager.preload();
  overlayManager.preload();

  // Open the WebSocket to the local python-service in the background so the
  // first prompt doesn't wait for the connection.
  pythonClient.connect().catch(e => console.error('[Main] Background connect error:', e));

  let pythonHealthy = false;
  try {
    const isHealthy = await pythonClient.healthCheck();
    pythonHealthy = isHealthy;
    if (isHealthy) {
      console.log('[Main] Python service connected');
    } else {
      console.warn('[Main] Python service not available — start it with: npm run python:dev');
    }
  } catch (error) {
    console.warn('[Main] Could not connect to Python service');
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
      } else if (healthy && !pythonHealthy) {
        pythonHealthy = true;
        appWindowManager.send('python:recovered', {});
        overlayManager.send('python:recovered', {});
        console.log('[Main] Python service recovered');
      }
    } catch (healthErr) {
      if (pythonHealthy) {
        pythonHealthy = false;
        appWindowManager.send('python:unavailable', {});
        overlayManager.send('python:unavailable', {});
        console.warn('[Main] Python health check failed');
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  // Start network monitor — broadcasts online/offline status to all windows
  networkMonitor.start(
    (channel, data) => appWindowManager.send(channel, data),
    (channel, data) => overlayManager.send(channel, data),
    () => {
      appWindowManager.send('network:reconnected', {});
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
  // AUTO-LAUNCH (start at login) IPC
  // ============================================
  ipcMain.handle('auto-launch:get', () => ({
    enabled: getAutoLaunchPreference(),
    osState: app.getLoginItemSettings().openAtLogin,
  }));

  ipcMain.handle('auto-launch:set', (_event, enabled: boolean) => {
    setAutoLaunchPreference(!!enabled);
    applyAutoLaunchToOS(!!enabled);
    systemTray?.updateMenu();
    return { enabled: !!enabled };
  });

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

  // Enforce the stored auto-launch preference against the OS on every startup.
  // Default is enabled — fresh installs register themselves as a login item
  // so the app silently appears in the tray after the next reboot.
  syncAutoLaunchOnStartup();

  // Show the main window immediately unless this is a silent auto-launch at login.
  // On silent launch (boot auto-start), stay hidden in tray — user opens manually.
  if (!isSilentLaunch()) {
    appWindowManager.show();
  } else {
    console.log('[Main] Silent launch — starting in tray only');
  }

  console.log('[Main] ========================================');
  console.log('[Main] Prompt Optimizer ready!');
  console.log('[Main] - Type @prompt anywhere to open overlay');
  console.log('[Main] - Press Ctrl+5 to toggle overlay');
  console.log('[Main] - Click tray icon to open app window');
  console.log('[Main] ========================================');

  // ============================================
  // LOCAL SESSION
  // ============================================
  // No login: load the local user's data into the window, and start the
  // code-intelligence project watcher.
  startLocalSession(appWindowManager).catch(err => {
    console.error('[Main] Local session start failed:', err);
  });
  overlayManager.sendAuthState(true);
  startCodeIntelProjectServices('startup').catch(e =>
    console.warn('[Main] Code intelligence project startup failed:', e)
  );
}

async function shutdown() {
  console.log('[Main] Shutting down...');
  stopKeystrokeDetection();
  globalShortcut.unregisterAll();
  cleanupProjectHandlers();
  stopDetection();

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

  closeDb();

  console.log('[Main] Shutdown complete');
}

// ============================================
// GLOBAL ERROR GUARDS — prevent silent crashes in Electron main process
// ============================================
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error('[Main] Unhandled promise rejection (captured, process continues):', err.message);
});

process.on('uncaughtException', (err) => {
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
  // A second launch focuses the existing window.
  app.on('second-instance', () => {
    if (appWindowManager) {
      appWindowManager.show();
    }
  });

  // ============================================
  // APP LIFECYCLE
  // ============================================
  app.setName('Prmpt');
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.prmpt.desktop');
  }

  app.whenReady().then(async () => {
    // On macOS, proactively request microphone permission so the system dialog
    // appears before the user tries transcription. Bundle ID changes between
    // dev (Electron.app) and packaged (Prmpt.app) — each needs its own grant.
    // Without this, getUserMedia() in the renderer silently fails on first use.
    if (process.platform === 'darwin' && app.isPackaged) {
      const micStatus = systemPreferences.getMediaAccessStatus('microphone');
      if (micStatus !== 'granted') {
        systemPreferences.askForMediaAccess('microphone').then(granted => {
          console.log(`[Main] Microphone permission: ${granted ? 'granted' : 'denied'}`);
          if (!granted) {
          }
        }).catch(err => {
          console.warn('[Main] Microphone permission request failed:', err);
        });
      }

      // Automation (System Events) — required by osascript in the Rust native
      // module to bring the source app to the foreground before pasting. macOS
      // prompts on first use, but if it was denied, activate_pid() silently
      // fails and text gets pasted into the wrong window. Pre-flight check here
      // so we can warn the user early.
      const automationAllowed = systemPreferences.isTrustedAccessibilityClient(false);
      if (!automationAllowed) {
        // Trigger a test osascript call that will prompt for Automation permission
        // if not yet determined, or silently fail if already denied.
        const { exec } = require('child_process');
        exec('osascript -e \'tell application "System Events" to return name of first process whose frontmost is true\'', (err: any) => {
          if (err) {
            console.warn('[Main] Automation (System Events) permission not granted — text insertion may fail');
          } else {
            console.log('[Main] Automation (System Events) permission: granted');
          }
        });
      }
    }

    // Install our custom application menu BEFORE creating any window so that
    // the default Electron accelerators (Cmd+R reload, Cmd+= zoom, Cmd+Q
    // quit, Cmd+Alt+I devtools, etc.) never get registered.
    installApplicationMenu();

    // Set dock icon as early as possible on macOS
    if (process.platform === 'darwin') {
      try {
        const { nativeImage } = await import('electron');
        const dockIconPath = app.isPackaged
          ? path.join(process.resourcesPath, 'icon.icns')
          : path.join(app.getAppPath(), 'build', 'dock-icon.png');
        const dockIcon = nativeImage.createFromPath(dockIconPath);
        if (!dockIcon.isEmpty()) {
          app.dock?.setIcon(dockIcon);
          console.log('[Main] Dock icon set from:', dockIconPath);
        } else {
          console.warn('[Main] Dock icon empty, path:', dockIconPath);
        }
      } catch (err) {
        console.warn('[Main] Failed to set dock icon:', err);
      }
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

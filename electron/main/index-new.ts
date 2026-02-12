import { app, globalShortcut, ipcMain } from 'electron';
import { AppWindowManager } from './windows/app-window-manager';
import { OverlayWindowManager } from './overlay/overlay-window-manager';
import { SystemTray } from './windows/system-tray';
import { PythonClient } from './api/python-client';
import { SupabaseClientManager } from './database/supabase-client';
import { ChatService } from './database/services/chat-service';
import { OptimizationService } from './database/services/optimization-service';
import { UserService } from './database/services/user-service';
import { AuthService } from './database/services/auth-service';
import { SettingsService } from './database/services/settings-service';
import { PromptLibraryService } from './database/services/prompt-library-service';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import * as dotenv from 'dotenv';
import { authState } from './utils/auth-state';
import { registerAuthHandlers, checkAndRestoreSession } from './ipc-handlers/auth-handlers';
import { registerSettingsHandlers } from './ipc-handlers/settings-handlers';
import { registerUserHandlers } from './ipc-handlers/user-handlers';
import { registerChatHandlers } from './ipc-handlers/chat-handlers';
import { registerOverlayHandlers } from './ipc-handlers/overlay-ipc-handlers';

// Import modular IPC handlers (these auto-register on import)
import './ipc-handlers/prompt-library-handlers';

// Load environment variables from .env file
dotenv.config();

// ============================================
// GLOBAL STATE
// ============================================
let appWindowManager: AppWindowManager;
let overlayManager: OverlayWindowManager;
let systemTray: SystemTray;
let pythonClient: PythonClient;

// Keystroke tracking for @prompt detection
let typedBuffer = '';
const TRIGGER_PHRASE = '@prompt';
const MAX_BUFFER_SIZE = 50;
let shiftPressed = false;

// ============================================
// KEY CODE MAPPING
// ============================================
const KEYCODE_MAP: { [key: number]: string } = {
  [UiohookKey.Backquote]: '`',
  [UiohookKey['1']]: '1',
  [UiohookKey['2']]: '2',
  [UiohookKey['3']]: '3',
  [UiohookKey['4']]: '4',
  [UiohookKey['5']]: '5',
  [UiohookKey['6']]: '6',
  [UiohookKey['7']]: '7',
  [UiohookKey['8']]: '8',
  [UiohookKey['9']]: '9',
  [UiohookKey['0']]: '0',
  [UiohookKey.Minus]: '-',
  [UiohookKey.Equal]: '=',
  [UiohookKey.Backspace]: '\b',
  [UiohookKey.Q]: 'q',
  [UiohookKey.W]: 'w',
  [UiohookKey.E]: 'e',
  [UiohookKey.R]: 'r',
  [UiohookKey.T]: 't',
  [UiohookKey.Y]: 'y',
  [UiohookKey.U]: 'u',
  [UiohookKey.I]: 'i',
  [UiohookKey.O]: 'o',
  [UiohookKey.P]: 'p',
  [UiohookKey.BracketLeft]: '[',
  [UiohookKey.BracketRight]: ']',
  [UiohookKey.Backslash]: '\\',
  [UiohookKey.A]: 'a',
  [UiohookKey.S]: 's',
  [UiohookKey.D]: 'd',
  [UiohookKey.F]: 'f',
  [UiohookKey.G]: 'g',
  [UiohookKey.H]: 'h',
  [UiohookKey.J]: 'j',
  [UiohookKey.K]: 'k',
  [UiohookKey.L]: 'l',
  [UiohookKey.Semicolon]: ';',
  [UiohookKey.Quote]: "'",
  [UiohookKey.Z]: 'z',
  [UiohookKey.X]: 'x',
  [UiohookKey.C]: 'c',
  [UiohookKey.V]: 'v',
  [UiohookKey.B]: 'b',
  [UiohookKey.N]: 'n',
  [UiohookKey.M]: 'm',
  [UiohookKey.Comma]: ',',
  [UiohookKey.Period]: '.',
  [UiohookKey.Slash]: '/',
  [UiohookKey.Space]: ' ',
  [UiohookKey.Enter]: '\n',
};

const SHIFT_MAP: { [key: string]: string } = {
  '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
  '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', '-': '_',
  '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"',
  ',': '<', '.': '>', '/': '?',
};

// ============================================
// KEYSTROKE DETECTION
// ============================================
function startKeystrokeDetection() {
  uIOhook.on('keydown', (event: any) => {
    if (event.keycode === UiohookKey.Shift || event.keycode === UiohookKey.ShiftRight) {
      shiftPressed = true;
      return;
    }

    let char = KEYCODE_MAP[event.keycode];
    if (!char) return;

    if (event.shiftKey || shiftPressed) {
      if (char.length === 1 && /[a-z]/.test(char)) {
        char = char.toUpperCase();
      } else if (SHIFT_MAP[char]) {
        char = SHIFT_MAP[char];
      }
    }

    if (char === '\b') {
      typedBuffer = typedBuffer.slice(0, -1);
      return;
    }

    if (char === '\n') return;

    typedBuffer += char;

    if (typedBuffer.length > MAX_BUFFER_SIZE) {
      typedBuffer = typedBuffer.slice(-MAX_BUFFER_SIZE);
    }

    if (typedBuffer.toLowerCase().endsWith(TRIGGER_PHRASE)) {
      overlayManager.open(authState.isAuthenticated);
      typedBuffer = '';
    }
  });

  uIOhook.on('keyup', (event: any) => {
    if (event.keycode === UiohookKey.Shift || event.keycode === UiohookKey.ShiftRight) {
      shiftPressed = false;
    }
  });

  uIOhook.start();
}

function stopKeystrokeDetection() {
  uIOhook.stop();
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

  // Create app window manager
  appWindowManager = new AppWindowManager();

  // Create overlay manager (pre-load hidden window for instant open)
  overlayManager = new OverlayWindowManager();
  overlayManager.preload();

  // Initialize Python client
  pythonClient = new PythonClient('http://127.0.0.1:8001');

  try {
    const isHealthy = await pythonClient.healthCheck();
    if (isHealthy) {
      console.log('[Main] Python service connected');
    } else {
      console.warn('[Main] Python service not available');
    }
  } catch (error) {
    console.warn('[Main] Could not connect to Python service');
  }

  // ============================================
  // REGISTER IPC HANDLERS
  // ============================================
  registerAuthHandlers(appWindowManager);
  registerUserHandlers(appWindowManager);
  registerSettingsHandlers();
  registerChatHandlers(appWindowManager, pythonClient);
  registerOverlayHandlers(overlayManager, pythonClient, appWindowManager);

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
        // Notify overlay of auth change
        overlayManager.sendAuthState(true);
      } else if (event === 'SIGNED_OUT') {
        authState.isAuthenticated = false;
        authState.currentUserId = null;

        if (appWindowManager) {
          appWindowManager.send('auth:state-changed', {
            isAuthenticated: false,
            user: null,
          });
        }
        // Notify overlay of auth change
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
// APP LIFECYCLE
// ============================================
app.whenReady().then(async () => {
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
  globalShortcut.unregisterAll();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Show app window if user tries to open another instance
    if (appWindowManager) {
      appWindowManager.show();
    }
  });
}

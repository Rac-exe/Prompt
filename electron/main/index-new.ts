import { app, globalShortcut, ipcMain } from 'electron';
import { AppWindowManager } from './windows/app-window-manager';
import { FloatingPanel } from './overlay/floating-panel';
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

// Import modular IPC handlers (these auto-register on import)
import './ipc-handlers/prompt-library-handlers';

// Load environment variables from .env file
dotenv.config();

// ============================================
// GLOBAL STATE
// ============================================
let appWindowManager: AppWindowManager;
let floatingPanel: FloatingPanel;
let systemTray: SystemTray;
let pythonClient: PythonClient;

// Services
let chatService: ChatService;
let optimizationService: OptimizationService;
let userService: UserService;
let authService: AuthService;
let settingsService: SettingsService;
let promptLibraryService: PromptLibraryService;

// key tracking...

// Keystroke tracking for @prompt detection
let typedBuffer = '';
const TRIGGER_PHRASE = '@prompt';
const MAX_BUFFER_SIZE = 50;
let shiftPressed = false;

// Current optimization context


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
  console.log('[Main] Starting keystroke detection...');

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
      console.log('[Main] @prompt detected! Showing overlay...');
      showOverlay();
      typedBuffer = '';
    }
  });

  uIOhook.on('keyup', (event: any) => {
    if (event.keycode === UiohookKey.Shift || event.keycode === UiohookKey.ShiftRight) {
      shiftPressed = false;
    }
  });

  uIOhook.start();
  console.log('[Main] Keystroke detection started');
}

function stopKeystrokeDetection() {
  console.log('[Main] Stopping keystroke detection...');
  uIOhook.stop();
}

// ============================================
// OVERLAY CONTROL
// ============================================
function showOverlay() {
  if (floatingPanel) {
    floatingPanel.showAndFocusInput();
  }
}

function hideOverlay() {
  if (floatingPanel) {
    floatingPanel.hide();
  }
}

function toggleOverlay() {
  if (floatingPanel) {
    const window = floatingPanel.getWindow();
    if (window && window.isVisible()) {
      hideOverlay();
    } else {
      showOverlay();
    }
  }
}

// ============================================
// AUTH HELPERS
// ============================================

// ============================================
// IPC HANDLERS
// ============================================


// ============================================
// PROMPT LIBRARY IPC HANDLERS
// ============================================
// NOTE: These handlers have been moved to ./ipc-handlers/prompt-library-handlers.ts
// They are automatically registered on import at the top of this file

// ============================================
// INITIALIZATION
// ============================================
async function initialize() {
  console.log('[Main] Initializing Prompt Optimizer...');

  // Initialize Supabase (replace with your credentials)
  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[Main] ERROR: Supabase credentials not found!');
    console.error('[Main] Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables');
    return;
  }

  SupabaseClientManager.initialize(SUPABASE_URL, SUPABASE_KEY);

  // Initialize services
  chatService = new ChatService();
  optimizationService = new OptimizationService();
  userService = new UserService();
  authService = new AuthService();
  settingsService = new SettingsService();
  promptLibraryService = new PromptLibraryService();

  // Create app window manager EARLY so handlers can use it
  appWindowManager = new AppWindowManager();

  // Register Auth Handlers
  registerAuthHandlers(appWindowManager);

  // Register User & Settings Handlers
  registerUserHandlers(appWindowManager);
  registerSettingsHandlers();

  // ============================================
  // SESSION MANAGEMENT & AUTO-RESTORE
  // ============================================
  try {
    // Check for existing session and restore if valid
    const hasSession = await checkAndRestoreSession(appWindowManager);

    if (hasSession) {
      console.log('[Main] ✅ Session restored, user logged in');
    } else {
      console.log('[Main] ℹ️ No session found, user needs to log in');
    }

    // Set up auth state change listener
    authService.onAuthStateChange(async (event, session) => {
      console.log('[Main] Auth state changed:', event);

      if (event === 'SIGNED_IN' && session) {
        authState.isAuthenticated = true;
        authState.currentUserId = session.user.id;
        // logic is now handled by auth-handlers side effects or renderer reload
        // But we might need to notify renderer if this event comes from outside IPC
        if (appWindowManager) {
          // We can implement handleSuccessfulAuth here too if needed, 
          // but usually SIGNED_IN comes from our own signIn call which handles it.
          // If it comes from token refresh or auto-login, we might need it.
        }
      } else if (event === 'SIGNED_OUT') {
        authState.isAuthenticated = false;
        authState.currentUserId = null;

        if (appWindowManager) {
          appWindowManager.send('auth:state-changed', {
            isAuthenticated: false,
            user: null,
          });
        }
      } else if (event === 'TOKEN_REFRESHED' && session) {
        console.log('[Main] ✅ Session token refreshed');
      }
    });
  } catch (error) {
    console.error('[Main] Auth initialization error:', error);
  }

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

  // Create floating panel (overlay)
  floatingPanel = new FloatingPanel();
  floatingPanel.create();
  floatingPanel.hide();
  console.log('[Main] Floating panel created (hidden)');

  // Setup IPC handlers
  // Register Chat & Optimization Handlers
  registerChatHandlers(appWindowManager, pythonClient, floatingPanel);

  // Start keystroke detection for @prompt
  startKeystrokeDetection();

  // Register global hotkey Ctrl+5
  const registered = globalShortcut.register('CommandOrControl+5', () => {
    console.log('[Main] Ctrl+5 pressed');
    toggleOverlay();
  });

  if (registered) {
    console.log('[Main] Global hotkey registered: Ctrl+5');
  } else {
    console.error('[Main] Failed to register global hotkey');
  }

  // NOTE: appWindowManager already created above

  // Create system tray

  // Create system tray
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

  if (floatingPanel) {
    floatingPanel.destroy();
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
  console.log('[Main] All windows closed - staying in background');
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

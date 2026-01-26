import { app, globalShortcut, ipcMain } from 'electron';
import { AppWindowManager } from './windows/app-window-manager';
import { FloatingPanel } from './overlay/floating-panel';
import { SystemTray } from './windows/system-tray';
import { PythonClient } from './api/python-client';
import { SupabaseClientManager } from './database/supabase-client';
import { ChatService } from './database/services/chat-service';
import { OptimizationService } from './database/services/optimization-service';
import { UserService } from './database/services/user-service';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import * as dotenv from 'dotenv';

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

// Keystroke tracking for @prompt detection
let typedBuffer = '';
const TRIGGER_PHRASE = '@prompt';
const MAX_BUFFER_SIZE = 50;
let shiftPressed = false;

// Current optimization context
let currentOptimization: {
  optimizationId: string;
  originalText: string;
  optimizedText: string;
} | null = null;

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
// IPC HANDLERS
// ============================================
function setupIPC() {
  // Overlay: Prompt submission for optimization
  ipcMain.on('floating-panel:prompt-submit', async (event, data: string | { text: string; isRegenerate?: boolean }) => {
    const promptText = typeof data === 'string' ? data : data.text;
    const skipCache = typeof data === 'string' ? false : !!data.isRegenerate;

    console.log('[Main] Prompt submitted:', promptText.substring(0, 50));

    if (!pythonClient) {
      console.error('[Main] Python client not available');
      return;
    }

    try {
      const optimizedText = await pythonClient.optimize(promptText, skipCache);

      // Save optimization to database (source: overlay)
      const optimization = await optimizationService.saveOptimization(
        promptText,
        optimizedText,
        'overlay',
        {
          model: 'llama3.2',
          latency_ms: 0,
          source_context: { app: 'overlay' },
        }
      );

      currentOptimization = {
        optimizationId: optimization.id,
        originalText: promptText,
        optimizedText,
      };

      // Send result to overlay
      const panelWindow = floatingPanel?.getWindow();
      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.webContents.send('optimization-complete', {
          original: promptText,
          optimized: optimizedText,
        });
      }
    } catch (error) {
      console.error('[Main] Optimization failed:', error);
    }
  });

  // Overlay: Replace button clicked (mark optimization as applied)
  ipcMain.on('floating-panel:replace-text', async (event, data: { optimizedText: string }) => {
    console.log('[Main] Replace requested');

    if (currentOptimization) {
      await optimizationService.markAsApplied(currentOptimization.optimizationId);
    }

    // Copy to clipboard
    const { clipboard } = require('electron');
    clipboard.writeText(data.optimizedText);
    hideOverlay();
  });

  // Overlay: Dismiss
  ipcMain.on('floating-panel:dismiss', () => {
    console.log('[Main] Overlay dismissed');
    hideOverlay();
  });

  // App Window: Optimize prompt request
  ipcMain.on('app:optimize-prompt', async (event, promptText: string, isRegenerate: boolean = false) => {
    console.log('[Main] App window optimization request:', promptText.substring(0, 50));

    try {
      const optimizedText = await pythonClient.optimize(promptText, isRegenerate);

      // Save optimization to database (source: app_window)
      const optimization = await optimizationService.saveOptimization(
        promptText,
        optimizedText,
        'app_window',
        {
          model: 'llama3.2',
          source_context: { app: 'app_window' },
        }
      );

      currentOptimization = {
        optimizationId: optimization.id,
        originalText: promptText,
        optimizedText,
      };

      // Send result to app window
      appWindowManager.send('optimization-complete', {
        original: promptText,
        optimized: optimizedText,
      });
    } catch (error) {
      console.error('[Main] Optimization failed:', error);
    }
  });

  // App Window: Save to chat
  ipcMain.on('app:save-to-chat', async (event, originalText: string, optimizedText: string) => {
    console.log('[Main] Saving to chat...');

    try {
      // Get or create "Quick Optimizations" chat
      const chat = await chatService.getOrCreateQuickOptimizationsChat();

      // Add user message (original)
      await chatService.addMessage(chat.id, originalText, 'user');

      // Add assistant message (optimized)
      await chatService.addMessage(
        chat.id,
        optimizedText,
        'assistant',
        currentOptimization?.optimizationId
      );

      console.log('[Main] Saved to chat successfully');
      appWindowManager.send('chat-saved', { chatId: chat.id });
    } catch (error) {
      console.error('[Main] Failed to save to chat:', error);
    }
  });

  // App Window: Copy to clipboard
  ipcMain.on('app:copy-to-clipboard', (event, text: string) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
  });

  // App Window: Request user data
  ipcMain.on('app:request-user-data', async () => {
    try {
      const user = await userService.getCurrentUser();
      if (user) {
        appWindowManager.send('user-data-loaded', user);
      }
    } catch (error) {
      console.error('[Main] Failed to load user data:', error);
    }
  });

  // App Window: Sign out
  ipcMain.on('app:sign-out', async () => {
    try {
      await userService.signOut();
      app.quit();
    } catch (error) {
      console.error('[Main] Sign out failed:', error);
    }
  });
}

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

  // AUTO-LOGIN FOR TESTING (REMOVE IN PRODUCTION!)
  // Create a test user in Supabase dashboard first:
  // Email: test@example.com, Password: testpassword123
  try {
    const supabase = SupabaseClientManager.getClient();

    // Try to get existing session first
    const { data: sessionData } = await supabase.auth.getSession();

    if (!sessionData.session) {
      console.log('[Main] No existing session, attempting auto-login...');
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'testpassword123'
      });

      if (error) {
        console.error('[Main] Auto-login failed:', error.message);
        console.error('[Main] Please create a test user in Supabase:');
        console.error('[Main] Email: test@example.com, Password: testpassword123');
      } else {
        console.log('[Main] ✅ Auto-logged in as test@example.com');
      }
    } else {
      console.log('[Main] ✅ Using existing session');
    }

    // Ensure user profile exists in users table
    const user = await userService.getCurrentUser();
    if (user) {
      console.log('[Main] ✅ User profile loaded:', user.email);
    }
  } catch (error) {
    console.error('[Main] Auth error:', error);
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
  setupIPC();

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

  // Create app window manager (but don't show window yet)
  appWindowManager = new AppWindowManager();

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

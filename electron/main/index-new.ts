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
let authService: AuthService;
let settingsService: SettingsService;

// Auth state
let isUserAuthenticated = false;
let currentUserId: string | null = null;

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
// AUTH HELPERS
// ============================================
async function checkAndRestoreSession(): Promise<boolean> {
  try {
    console.log('[Main] Checking for existing session...');
    const { session, error } = await authService.getSession();

    if (error || !session) {
      console.log('[Main] No valid session found');
      isUserAuthenticated = false;
      currentUserId = null;
      return false;
    }

    console.log('[Main] ✅ Valid session found, user authenticated');
    isUserAuthenticated = true;
    currentUserId = session.user.id;

    // Load user data
    const userData = await userService.getCompleteUserData();
    if (userData && appWindowManager) {
      appWindowManager.send('user-data-loaded', userData);
    }

    return true;
  } catch (error) {
    console.error('[Main] Error checking session:', error);
    isUserAuthenticated = false;
    currentUserId = null;
    return false;
  }
}

async function handleSuccessfulAuth() {
  try {
    // Get user data
    const { user } = await authService.getCurrentUser();
    if (!user) {
      console.error('[Main] No user after authentication');
      return;
    }

    isUserAuthenticated = true;
    currentUserId = user.id;

    // Load complete user data
    const userData = await userService.getCompleteUserData();

    console.log('[Main] ✅ User authenticated and data loaded');

    // Send auth state to window
    if (appWindowManager) {
      const window = appWindowManager.getWindow();
      if (window && !window.isDestroyed()) {
        // Small delay to ensure renderer is ready
        setTimeout(() => {
          console.log('[Main] 📤 Sending auth state to renderer');
          appWindowManager.send('auth:state-changed', {
            isAuthenticated: true,
            user: userData,
          });

          // Load chats
          chatService.getChats().then(chats => {
            appWindowManager.send('chats-loaded', { chats });
          }).catch(err => console.error('[Main] Error loading chats:', err));
        }, 100);
      }
    }
  } catch (error) {
    console.error('[Main] Error handling successful auth:', error);
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
      // Get personalization prompt if user is authenticated
      let finalPrompt = promptText;
      if (isUserAuthenticated) {
        const personalizationPrompt = await userService.getPersonalizationPrompt();
        if (personalizationPrompt) {
          // Prepend personalization instructions (done internally by Python service)
          console.log('[Main] Using personalization prompt');
          // Note: You could pass this to Python service if you want to handle it there
        }
      }

      const optimizedText = await pythonClient.optimize(finalPrompt, skipCache);

      // Save optimization to database (source: overlay) - only if authenticated
      if (isUserAuthenticated) {
        try {
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
        } catch (dbError) {
          console.error('[Main] Failed to save optimization to DB (continuing anyway):', dbError);
        }
      } else {
        console.log('[Main] ℹ️ User not authenticated, optimization not saved to DB');
      }

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
      // Get personalization prompt if user is authenticated
      let finalPrompt = promptText;
      if (isUserAuthenticated) {
        const personalizationPrompt = await userService.getPersonalizationPrompt();
        if (personalizationPrompt) {
          console.log('[Main] Using personalization prompt for app window optimization');
          // Note: You could pass this to Python service if you want to handle it there
        }
      }

      const optimizedText = await pythonClient.optimize(finalPrompt, isRegenerate);

      // Save optimization to database (source: app_window) - only if authenticated
      if (isUserAuthenticated) {
        try {
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
        } catch (dbError) {
          console.error('[Main] Failed to save optimization to DB (continuing anyway):', dbError);
        }
      }

      // Send result to app window
      appWindowManager.send('optimization-complete', {
        original: promptText,
        optimized: optimizedText,
      });
    } catch (error) {
      console.error('[Main] Optimization failed:', error);
      appWindowManager.send('optimization-complete', {
        original: promptText,
        optimized: 'Optimization failed. Please try again.',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
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
      const userData = await userService.getCompleteUserData();
      if (userData) {
        appWindowManager.send('user-data-loaded', userData);
      }
    } catch (error) {
      console.error('[Main] Failed to load user data:', error);
    }
  });

  // App Window: Sign out
  ipcMain.on('app:sign-out', async () => {
    try {
      await authService.signOut();
      isUserAuthenticated = false;
      currentUserId = null;

      // Notify window
      if (appWindowManager) {
        appWindowManager.send('auth:state-changed', {
          isAuthenticated: false,
          user: null,
        });
      }

      console.log('[Main] ✅ User signed out');
    } catch (error) {
      console.error('[Main] Sign out failed:', error);
    }
  });

  // ============================================
  // AUTH IPC HANDLERS
  // ============================================

  // Sign Up
  ipcMain.on('auth:sign-up', async (event, data: { name: string; dob: string; email: string; password: string }) => {
    try {
      console.log('[Main] Sign up request for:', data.email);

      const { user, error } = await authService.signUp(data);

      if (error || !user) {
        console.error('[Main] Sign up failed:', error?.message);
        if (appWindowManager) {
          appWindowManager.send('auth:state-changed', {
            isAuthenticated: false,
            user: null,
            error: error?.message || 'Sign up failed',
          });
        }
        return;
      }

      console.log('[Main] ✅ Sign up successful, signing in...');

      // Auto-sign in after signup
      const { session: signInSession, error: signInError } = await authService.signIn({
        email: data.email,
        password: data.password,
      });

      if (signInError || !signInSession) {
        console.error('[Main] Auto sign-in after signup failed:', signInError?.message);
        return;
      }

      await handleSuccessfulAuth();
    } catch (error) {
      console.error('[Main] Unexpected sign up error:', error);
      if (appWindowManager) {
        appWindowManager.send('auth:state-changed', {
          isAuthenticated: false,
          user: null,
          error: 'Sign up failed',
        });
      }
    }
  });

  // Sign In
  ipcMain.on('auth:sign-in', async (event, data: { email: string; password: string }) => {
    try {
      console.log('[Main] Sign in request for:', data.email);

      const { session, error } = await authService.signIn(data);

      if (error || !session) {
        console.error('[Main] Sign in failed:', error?.message);
        if (appWindowManager) {
          appWindowManager.send('auth:state-changed', {
            isAuthenticated: false,
            user: null,
            error: error?.message || 'Sign in failed',
          });
        }
        return;
      }

      console.log('[Main] ✅ Sign in successful');
      await handleSuccessfulAuth();
    } catch (error) {
      console.error('[Main] Unexpected sign in error:', error);
      if (appWindowManager) {
        appWindowManager.send('auth:state-changed', {
          isAuthenticated: false,
          user: null,
          error: 'Sign in failed',
        });
      }
    }
  });

  // Check Auth Status
  ipcMain.on('auth:check', async () => {
    try {
      console.log('[Main] 📥 Renderer requested auth check');
      const isAuth = await checkAndRestoreSession();

      if (appWindowManager) {
        if (isAuth) {
          const userData = await userService.getCompleteUserData();
          console.log('[Main] 📤 Sending authenticated state to renderer');
          appWindowManager.send('auth:state-changed', {
            isAuthenticated: true,
            user: userData,
          });

          // Also load chats
          const chats = await chatService.getChats();
          appWindowManager.send('chats-loaded', { chats });
        } else {
          console.log('[Main] 📤 Sending unauthenticated state to renderer');
          appWindowManager.send('auth:state-changed', {
            isAuthenticated: false,
            user: null,
          });
        }
      }
    } catch (error) {
      console.error('[Main] Error checking auth:', error);
      if (appWindowManager) {
        appWindowManager.send('auth:state-changed', {
          isAuthenticated: false,
          user: null,
          error: 'Auth check failed',
        });
      }
    }
  });

  // ============================================
  // USER PROFILE & PREFERENCES IPC HANDLERS
  // ============================================

  // Update Profile
  ipcMain.on('user:update-profile', async (event, updates) => {
    try {
      if (!isUserAuthenticated) {
        console.error('[Main] Cannot update profile: not authenticated');
        return;
      }

      await userService.updateProfile(updates);

      if (appWindowManager) {
        appWindowManager.send('user:profile-updated');

        // Send updated user data
        const userData = await userService.getCompleteUserData();
        appWindowManager.send('user-data-loaded', userData);
      }

      console.log('[Main] ✅ Profile updated');
    } catch (error) {
      console.error('[Main] Error updating profile:', error);
    }
  });

  // Update Preferences
  ipcMain.on('user:update-preferences', async (event, updates) => {
    try {
      if (!isUserAuthenticated) {
        console.error('[Main] Cannot update preferences: not authenticated');
        return;
      }

      await userService.updatePreferences(updates);

      if (appWindowManager) {
        appWindowManager.send('user:preferences-updated');

        // Send updated user data
        const userData = await userService.getCompleteUserData();
        appWindowManager.send('user-data-loaded', userData);
      }

      console.log('[Main] ✅ Preferences updated');
    } catch (error) {
      console.error('[Main] Error updating preferences:', error);
    }
  });

  // Set Personalization Prompt
  ipcMain.on('user:set-personalization-prompt', async (event, prompt: string) => {
    try {
      if (!isUserAuthenticated) {
        console.error('[Main] Cannot set personalization prompt: not authenticated');
        return;
      }

      await userService.setPersonalizationPrompt(prompt);

      if (appWindowManager) {
        appWindowManager.send('user:preferences-updated');
      }

      console.log('[Main] ✅ Personalization prompt updated');
    } catch (error) {
      console.error('[Main] Error setting personalization prompt:', error);
    }
  });

  // ============================================
  // SETTINGS IPC HANDLERS
  // ============================================

  // Load user settings
  ipcMain.handle('settings:load', async () => {
    try {
      if (!isUserAuthenticated || !currentUserId) {
        console.log('[Main] User not authenticated, returning default settings');
        return {
          theme: 'dark',
          font_size: 'medium',
          font_family: 'inter',
          prompt_instructions: '',
        };
      }

      const settings = await settingsService.getOrCreateSettings(currentUserId);
      console.log('[Main] ✅ Settings loaded for user:', currentUserId);
      return settings;
    } catch (error) {
      console.error('[Main] Error loading settings:', error);
      // Return defaults on error
      return {
        theme: 'dark',
        font_size: 'medium',
        font_family: 'inter',
        prompt_instructions: '',
      };
    }
  });

  // Save user settings
  ipcMain.handle('settings:save', async (event, settings) => {
    try {
      if (!isUserAuthenticated || !currentUserId) {
        throw new Error('User must be authenticated to save settings');
      }

      const saved = await settingsService.upsertUserSettings(currentUserId, settings);
      console.log('[Main] ✅ Settings saved for user:', currentUserId);
      return saved;
    } catch (error) {
      console.error('[Main] Error saving settings:', error);
      throw error;
    }
  });

  // App Window: Load chats
  ipcMain.on('app:load-chats', async (event) => {
    try {
      console.log('[Main] Loading chats...');
      const chats = await chatService.getChats();
      appWindowManager.send('chats-loaded', { chats });
    } catch (error) {
      console.error('[Main] Failed to load chats:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appWindowManager.send('chats-loaded', { chats: [], error: errorMessage });
    }
  });

  // App Window: Create new chat
  ipcMain.on('app:create-chat', async (event, title?: string) => {
    try {
      console.log('[Main] Creating new chat...');
      const chat = await chatService.createChat(title);
      appWindowManager.send('chat-created', { chat });
      // Reload chats list
      const chats = await chatService.getChats();
      appWindowManager.send('chats-loaded', { chats });
    } catch (error) {
      console.error('[Main] Failed to create chat:', error);
    }
  });

  // App Window: Load messages for a chat
  ipcMain.on('app:load-messages', async (event, chatId: string) => {
    try {
      console.log('[Main] Loading messages for chat:', chatId);
      const messages = await chatService.getMessages(chatId);
      appWindowManager.send('messages-loaded', { chatId, messages });
    } catch (error) {
      console.error('[Main] Failed to load messages:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appWindowManager.send('messages-loaded', { chatId, messages: [], error: errorMessage });
    }
  });

  // App Window: Send message (creates chat if needed, saves message, triggers optimization)
  ipcMain.on('app:send-message', async (event, data: { chatId: string | null; content: string }) => {
    try {
      console.log('[Main] 📥 Received send-message request:', {
        chatId: data.chatId,
        contentLength: data.content.length
      });

      let chatId = data.chatId;
      let chat;

      // Create chat if it doesn't exist
      if (!chatId) {
        console.log('[Main] 🆕 No chat ID provided, creating new chat');
        const title = data.content.slice(0, 50) + (data.content.length > 50 ? '...' : '');

        // Verify user is authenticated
        if (!isUserAuthenticated) {
          throw new Error('User must be authenticated to create chat');
        }

        chat = await chatService.createChat(title);
        chatId = chat.id;

        console.log('[Main] ✅ Created new chat in Supabase:', {
          chatId: chat.id,
          title: chat.title,
          user_id: chat.user_id
        });
      } else {
        console.log('[Main] 📂 Using existing chat:', chatId);
        chat = await chatService.getChat(chatId);
      }

      // Save user message to database
      console.log('[Main] 💾 Saving user message to Supabase...');
      const userMessage = await chatService.addMessage(chatId, data.content, 'user');
      console.log('[Main] ✅ User message saved:', userMessage.id);

      // Send immediate confirmation with chat and user message
      appWindowManager.send('message-sent', {
        chatId,
        chat,
        userMessage: {
          id: userMessage.id,
          chatId: userMessage.chat_id,
          role: userMessage.role,
          content: userMessage.content,
          createdAt: userMessage.created_at,
        }
      });

      // Trigger optimization
      console.log('[Main] 🤖 Triggering optimization...');
      const optimizedText = await pythonClient.optimize(data.content, false);
      console.log('[Main] ✅ Optimization complete');

      // Save optimization record to DB (for analytics)
      let optimizationId: string | undefined;
      if (isUserAuthenticated) {
        try {
          const optimization = await optimizationService.saveOptimization(
            data.content,
            optimizedText,
            'app_window',
            { model: 'llama3.2', source_context: { app: 'app_window', chat_id: chatId } }
          );
          optimizationId = optimization.id;
          console.log('[Main] ✅ Optimization record saved:', optimizationId);
        } catch (dbError) {
          console.error('[Main] ⚠️ Failed to save optimization record (continuing):', dbError);
        }
      }

      // Save assistant message to database
      console.log('[Main] 💾 Saving assistant message to Supabase...');
      const assistantMessage = await chatService.addMessage(
        chatId,
        optimizedText,
        'assistant',
        optimizationId,
        { model: 'llama3.2', optimized: true }
      );
      console.log('[Main] ✅ Assistant message saved:', assistantMessage.id);

      // Send assistant message to renderer
      appWindowManager.send('message-received', {
        chatId,
        message: {
          id: assistantMessage.id,
          chatId: assistantMessage.chat_id,
          role: assistantMessage.role,
          content: assistantMessage.content,
          createdAt: assistantMessage.created_at,
        }
      });

      // Reload chats list to update timestamps
      const chats = await chatService.getChats();
      appWindowManager.send('chats-loaded', { chats });

      console.log('[Main] ✅ Message flow complete');
    } catch (error) {
      console.error('[Main] ❌ Failed to send message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appWindowManager.send('message-send-error', {
        error: errorMessage,
        details: error instanceof Error ? error.stack : undefined
      });
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
  authService = new AuthService();
  settingsService = new SettingsService();

  // ============================================
  // SESSION MANAGEMENT & AUTO-RESTORE
  // ============================================
  try {
    // Check for existing session and restore if valid
    const hasSession = await checkAndRestoreSession();

    if (hasSession) {
      console.log('[Main] ✅ Session restored, user logged in');
    } else {
      console.log('[Main] ℹ️ No session found, user needs to log in');
    }

    // Set up auth state change listener
    authService.onAuthStateChange(async (event, session) => {
      console.log('[Main] Auth state changed:', event);

      if (event === 'SIGNED_IN' && session) {
        isUserAuthenticated = true;
        currentUserId = session.user.id;
        await handleSuccessfulAuth();
      } else if (event === 'SIGNED_OUT') {
        isUserAuthenticated = false;
        currentUserId = null;

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

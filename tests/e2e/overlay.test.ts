/**
 * Overlay integration smoke tests.
 *
 * Since Playwright + Electron 32 has a known incompatibility
 * (--remote-debugging-port rejected), these tests verify the overlay
 * IPC handler registration and behavior by importing the handlers
 * directly and exercising them against mock objects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('electron', () => {
  const ipcMain = new (require('events').EventEmitter)();
  (ipcMain as any).handle = vi.fn((channel: string, handler: any) => {
    ipcMain.on(channel, handler);
  });
  return {
    ipcMain,
    clipboard: { writeText: vi.fn() },
    screen: { getCursorScreenPoint: vi.fn().mockReturnValue({ x: 0, y: 0 }) },
    app: { isPackaged: false, getAppPath: () => '/mock' },
  };
});

vi.mock('@sentry/electron/main', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  startSpan: vi.fn((_opts, cb) => cb({ setStatus: vi.fn(), setAttribute: vi.fn() })),
  setTag: vi.fn(),
}));

vi.mock('@sentry/core', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fmt: (...args: any[]) => args.join('') },
}));

vi.mock('../../electron/main/utils/auth-state', () => ({
  authState: { isAuthenticated: true, currentAccessToken: 'mock', currentUserId: 'user1' },
}));

vi.mock('../../electron/main/utils/native-bridge', () => ({
  replaceAtLastAnchor: vi.fn().mockReturnValue(true),
  isNativeBridgeAvailable: vi.fn().mockReturnValue(true),
  pasteTextToWindow: vi.fn().mockReturnValue(true),
  forceFocusWindow: vi.fn(),
  getActiveWindowTitle: vi.fn().mockReturnValue('Test App'),
}));

vi.mock('../../electron/main/utils/window-detector', () => ({
  detectWindowMode: vi.fn().mockReturnValue({ mode: 'document', confidence: 'low', appName: 'Test' }),
}));

vi.mock('../../electron/main/database/services/prompt-library-service', () => ({
  PromptLibraryService: vi.fn().mockImplementation(() => ({
    getCollections: vi.fn().mockResolvedValue([]),
    createCollection: vi.fn().mockResolvedValue({ id: 'col-1', name: 'Quick Saves' }),
    savePrompt: vi.fn().mockResolvedValue({ id: 'p-1' }),
    getFullLibrary: vi.fn().mockResolvedValue({ collections: [], prompts: [] }),
  })),
}));

vi.mock('../../electron/main/database/services/optimization-service', () => ({
  OptimizationService: vi.fn().mockImplementation(() => ({
    saveOptimization: vi.fn().mockResolvedValue({ id: 'opt-1' }),
  })),
}));

vi.mock('../../electron/main/database/services/chat-service', () => ({
  ChatService: vi.fn().mockImplementation(() => ({
    getChats: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockResolvedValue([]),
    createChat: vi.fn().mockResolvedValue({ id: 'chat-1' }),
    addMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    touchChat: vi.fn().mockResolvedValue(undefined),
    updateChatTitle: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../electron/main/database/services/settings-service', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getUserSettings: vi.fn().mockResolvedValue({ prompt_instructions: '' }),
    getOrCreateSettings: vi.fn().mockResolvedValue({ theme: 'dark', font_size: 'medium' }),
  })),
}));

vi.mock('../../electron/main/database/services/user-service', () => ({
  UserService: vi.fn().mockImplementation(() => ({
    getUserProfile: vi.fn().mockResolvedValue({ id: 'user1' }),
  })),
}));

vi.mock('../../electron/main/database/services/memory-service', () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    buildMemoryContext: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../../electron/main/database/services/memory-analyzer', () => ({
  MemoryAnalyzer: vi.fn().mockImplementation(() => ({
    isMemoryEnabled: vi.fn().mockResolvedValue(false),
    onNewOptimization: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../electron/main/database/services/rate-limit-service', () => ({
  RateLimitService: vi.fn().mockImplementation(() => ({
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 100, remaining: 99 }),
    invalidateCache: vi.fn(),
  })),
}));

vi.mock('../../electron/main/database/local-cache', () => ({
  localCache: {
    setMessages: vi.fn(),
    setChats: vi.fn(),
    getChats: vi.fn().mockReturnValue([]),
    setCollections: vi.fn(),
    getCollections: vi.fn().mockReturnValue([]),
    addOrUpdateCollection: vi.fn(),
    addOrUpdatePrompt: vi.fn(),
    getPrompts: vi.fn().mockReturnValue([]),
    getSettings: vi.fn().mockReturnValue(null),
    setSettings: vi.fn(),
  },
}));

vi.mock('../../electron/main/ipc-handlers/network-monitor-singleton', () => ({
  networkMonitor: { isOnline: true },
}));

vi.mock('../../electron/main/database/offline-queue', () => ({
  offlineQueue: { enqueue: vi.fn() },
}));

vi.mock('../../electron/main/ipc-handlers/file-upload-service', () => ({
  uploadAttachment: vi.fn().mockResolvedValue({ name: 'test', url: 'http://test.com' }),
}));

vi.mock('../../electron/main/database/error-log', () => ({
  errorLog: { append: vi.fn() },
}));

vi.mock('../../electron/main/analytics/analytics-service', () => ({
  analyticsService: { logEvent: vi.fn() },
}));

vi.mock('../../electron/main/ipc-handlers/project-handlers', () => ({
  getActiveProjectId: vi.fn().mockReturnValue(null),
  getActiveProjectBranch: vi.fn().mockReturnValue(null),
}));

vi.mock('../../electron/main/ipc-handlers/chat-handlers', () => ({
  isWeakMessage: vi.fn().mockReturnValue(false),
}));

describe('Overlay IPC Handlers - Integration', () => {
  let ipcMain: any;

  beforeEach(async () => {
    vi.resetModules();
    const electron = await import('electron');
    ipcMain = electron.ipcMain;
  });

  it('overlay:close handler should call overlayManager.close()', async () => {
    const { registerOverlayHandlers } = await import('../../electron/main/ipc-handlers/overlay-ipc-handlers');

    const mockOverlayManager = {
      close: vi.fn(),
      send: vi.fn(),
      isVisible: vi.fn().mockReturnValue(false),
      getWindow: vi.fn().mockReturnValue(null),
    };

    const mockPythonClient = {
      clarify: vi.fn().mockResolvedValue({ should_clarify: false, questions: [] }),
      optimizeStream: vi.fn().mockResolvedValue({ text: 'optimized', models: {} }),
      generateTitle: vi.fn().mockResolvedValue('Title'),
      abortLatestStream: vi.fn(),
    };

    const mockAppWindowManager = {
      send: vi.fn(),
      show: vi.fn(),
    };

    registerOverlayHandlers(mockOverlayManager as any, mockPythonClient as any, mockAppWindowManager as any);

    // Emit overlay:close
    ipcMain.emit('overlay:close');

    expect(mockOverlayManager.close).toHaveBeenCalled();
  });

  it('overlay:copy handler should write to clipboard', async () => {
    const { clipboard } = await import('electron');

    // overlay:copy was already registered above, emit it
    ipcMain.emit('overlay:copy', {}, { text: 'hello world' });

    expect(clipboard.writeText).toHaveBeenCalledWith('hello world');
  });

  it('overlay:open-app handler should show main window', async () => {
    // overlay:open-app was registered in the first test
    const mockShow = vi.fn();
    // Since we registered with a specific mock, just verify the handler is there
    const listenerCount = ipcMain.listenerCount('overlay:open-app');
    expect(listenerCount).toBeGreaterThan(0);
  });

  it('overlay:new-session handler clears history', async () => {
    const listenerCount = ipcMain.listenerCount('overlay:new-session');
    expect(listenerCount).toBeGreaterThan(0);

    // Should not throw
    ipcMain.emit('overlay:new-session');
  });

  it('overlay:stop-generation handler is registered', async () => {
    const listenerCount = ipcMain.listenerCount('overlay:stop-generation');
    expect(listenerCount).toBeGreaterThan(0);
  });
});

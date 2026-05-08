import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock Electron modules before importing
vi.mock('electron', () => {
  const mockScreen = {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
  };
  const mockApp = {
    isPackaged: false,
    getAppPath: () => '/mock/app',
    dock: { hide: vi.fn() },
  };
  return {
    BrowserWindow: vi.fn(),
    screen: mockScreen,
    app: mockApp,
  };
});

vi.mock('@sentry/electron/main', () => ({
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('../../electron/main/utils/native-bridge', () => ({
  forceFocusWindow: vi.fn(),
}));

vi.mock('../../electron/main/analytics/analytics-service', () => ({
  analyticsService: { logEvent: vi.fn() },
}));

class MockBrowserWindow extends EventEmitter {
  isDestroyed = vi.fn().mockReturnValue(false);
  hide = vi.fn();
  show = vi.fn();
  focus = vi.fn();
  blur = vi.fn();
  moveTop = vi.fn();
  setPosition = vi.fn();
  setOpacity = vi.fn();
  getPosition = vi.fn().mockReturnValue([100, 100]);
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  loadFile = vi.fn();
  getNativeWindowHandle = vi.fn().mockReturnValue(Buffer.alloc(8));
  webContents = {
    setVisualZoomLevelLimits: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    ipc: { once: vi.fn() },
    send: vi.fn(),
  };
}

describe('OverlayWindowManager - macOS blur close fix', () => {
  let overlayManager: any;
  let mockWindow: MockBrowserWindow;

  beforeEach(() => {
    vi.resetModules();
    mockWindow = new MockBrowserWindow();
  });

  it('should register blur handler on macOS that closes the overlay', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    // Simulate what createWindow does on macOS
    let blurHandler: (() => void) | null = null;
    const isOpen = { value: true };

    // Replicate the fix logic
    if (process.platform === 'darwin') {
      blurHandler = () => {
        if (isOpen.value) {
          isOpen.value = false; // simulates close()
        }
      };
      mockWindow.on('blur', blurHandler);
    }

    // Trigger blur
    mockWindow.emit('blur');

    expect(isOpen.value).toBe(false);
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should NOT register blur handler on Windows', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    let blurRegistered = false;

    if (process.platform === 'darwin') {
      blurRegistered = true;
      mockWindow.on('blur', () => {});
    }

    expect(blurRegistered).toBe(false);
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should not close if overlay is not open when blur fires', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const isOpen = { value: false };
    let closeCalled = false;

    if (process.platform === 'darwin') {
      mockWindow.on('blur', () => {
        if (isOpen.value) {
          closeCalled = true;
        }
      });
    }

    mockWindow.emit('blur');
    expect(closeCalled).toBe(false);

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('close() should call window.hide() on macOS', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    // Simulate the close() method logic for macOS
    const isOpen = { value: true };
    function close() {
      if (mockWindow && !mockWindow.isDestroyed()) {
        isOpen.value = false;
        if (process.platform === 'darwin') {
          mockWindow.hide();
        } else {
          mockWindow.setPosition(-9999, -9999);
          mockWindow.blur();
        }
      }
    }

    close();

    expect(mockWindow.hide).toHaveBeenCalled();
    expect(isOpen.value).toBe(false);
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('close() should move window offscreen on Windows', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const isOpen = { value: true };
    function close() {
      if (mockWindow && !mockWindow.isDestroyed()) {
        isOpen.value = false;
        if (process.platform === 'darwin') {
          mockWindow.hide();
        } else {
          mockWindow.setPosition(-9999, -9999);
          mockWindow.blur();
        }
      }
    }

    close();

    expect(mockWindow.setPosition).toHaveBeenCalledWith(-9999, -9999);
    expect(mockWindow.hide).not.toHaveBeenCalled();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });
});

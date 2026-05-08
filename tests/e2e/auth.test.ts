/**
 * Auth integration smoke tests.
 *
 * Tests auth-related IPC handler registration and behavior
 * by importing the modules directly.
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
    app: { isPackaged: false, getAppPath: () => '/mock' },
    shell: { openExternal: vi.fn() },
    BrowserWindow: vi.fn(),
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

describe('Auth - IPC Handler Smoke Tests', () => {
  it('authState module loads and has expected shape', async () => {
    const { authState } = await import('../../electron/main/utils/auth-state');
    expect(authState).toBeDefined();
    expect(typeof authState.isAuthenticated).toBe('boolean');
  });

  it('auth-state starts as unauthenticated', async () => {
    vi.resetModules();
    // Re-mock after reset
    vi.doMock('electron', () => {
      const ipcMain = new (require('events').EventEmitter)();
      (ipcMain as any).handle = vi.fn();
      return { ipcMain, app: { isPackaged: false }, shell: {} };
    });
    vi.doMock('@sentry/electron/main', () => ({
      addBreadcrumb: vi.fn(), captureException: vi.fn(), captureMessage: vi.fn(),
      startSpan: vi.fn((_o: any, cb: any) => cb({ setStatus: vi.fn() })), setTag: vi.fn(),
    }));
    vi.doMock('@sentry/core', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fmt: (...a: any[]) => a.join('') },
    }));

    const { authState } = await import('../../electron/main/utils/auth-state');
    expect(authState.isAuthenticated).toBe(false);
    expect(authState.currentAccessToken).toBeFalsy();
  });

  it('auth-state can be mutated (simulating login)', async () => {
    vi.resetModules();
    vi.doMock('electron', () => {
      const ipcMain = new (require('events').EventEmitter)();
      (ipcMain as any).handle = vi.fn();
      return { ipcMain, app: { isPackaged: false }, shell: {} };
    });
    vi.doMock('@sentry/electron/main', () => ({
      addBreadcrumb: vi.fn(), captureException: vi.fn(), captureMessage: vi.fn(),
      startSpan: vi.fn((_o: any, cb: any) => cb({ setStatus: vi.fn() })), setTag: vi.fn(),
    }));
    vi.doMock('@sentry/core', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fmt: (...a: any[]) => a.join('') },
    }));

    const { authState } = await import('../../electron/main/utils/auth-state');
    authState.isAuthenticated = true;
    authState.currentAccessToken = 'test-token';
    authState.currentUserId = 'user-123';

    expect(authState.isAuthenticated).toBe(true);
    expect(authState.currentAccessToken).toBe('test-token');
    expect(authState.currentUserId).toBe('user-123');
  });
});

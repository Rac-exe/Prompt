/**
 * Prompt Library integration smoke tests.
 *
 * Tests that prompt library IPC handlers are wired correctly
 * by importing the handler modules with mocked dependencies.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';

const mockIpcMain = new EventEmitter();
(mockIpcMain as any).handle = vi.fn((channel: string, handler: any) => {
  mockIpcMain.on(channel, handler);
});

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: { isPackaged: false, getAppPath: () => '/mock' },
}));

vi.mock('../../electron/main/utils/auth-state', () => ({
  authState: { isAuthenticated: true, currentUserId: 'user1', currentUserEmail: null },
}));

vi.mock('../../electron/main/database/services/prompt-library-service', () => {
  class MockPromptLibraryService {
    getCollections = vi.fn().mockResolvedValue([{ id: 'c1', name: 'Default', icon: '📁' }]);
    createCollection = vi.fn().mockResolvedValue({ id: 'c2', name: 'New', icon: '⚡' });
    savePrompt = vi.fn().mockResolvedValue({ id: 'p1', title: 'Test', content: 'Hello' });
    deletePrompt = vi.fn().mockResolvedValue(undefined);
    updatePrompt = vi.fn().mockResolvedValue({ id: 'p1', title: 'Updated' });
    toggleFavorite = vi.fn().mockResolvedValue({ id: 'p1', is_favorite: true });
    getFullLibrary = vi.fn().mockResolvedValue({ collections: [], prompts: [] });
    deleteCollection = vi.fn().mockResolvedValue(undefined);
    renameCollection = vi.fn().mockResolvedValue({ id: 'c1', name: 'Renamed' });
  }
  return { PromptLibraryService: MockPromptLibraryService };
});

describe('Prompt Library - IPC Handler Smoke Tests', () => {
  it('prompt-library handlers get registered on import', async () => {
    // This module auto-registers handlers on import
    await import('../../electron/main/ipc-handlers/prompt-library-handlers');

    const registeredChannels = (mockIpcMain as any).handle.mock.calls.map((c: any) => c[0]);

    expect(registeredChannels).toContain('prompt-library:get-collections');
    expect(registeredChannels).toContain('prompt-library:get-all');
    expect(registeredChannels).toContain('prompt-library:create-collection');
    expect(registeredChannels).toContain('prompt-library:save-prompt');
    expect(registeredChannels).toContain('prompt-library:delete-prompt');
    expect(registeredChannels).toContain('prompt-library:toggle-favorite');
  });

  it('get-collections handler returns collections array', async () => {
    const handleCalls = (mockIpcMain as any).handle.mock.calls;
    const getCollectionsHandler = handleCalls.find((c: any) => c[0] === 'prompt-library:get-collections');

    if (getCollectionsHandler) {
      const handler = getCollectionsHandler[1];
      const result = await handler({});
      expect(Array.isArray(result)).toBe(true);
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('macOS Permission Requests', () => {
  let originalPlatform: string;

  beforeEach(() => {
    originalPlatform = process.platform;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('Microphone Permission', () => {
    it('should request microphone access on macOS when packaged and not granted', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const askForMediaAccess = vi.fn().mockResolvedValue(true);
      const getMediaAccessStatus = vi.fn().mockReturnValue('not-determined');
      const isPackaged = true;

      // Replicate the permission request logic from index-new.ts
      if (process.platform === 'darwin' && isPackaged) {
        const micStatus = getMediaAccessStatus('microphone');
        if (micStatus !== 'granted') {
          await askForMediaAccess('microphone');
        }
      }

      expect(getMediaAccessStatus).toHaveBeenCalledWith('microphone');
      expect(askForMediaAccess).toHaveBeenCalledWith('microphone');
    });

    it('should NOT request microphone access when already granted', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const askForMediaAccess = vi.fn().mockResolvedValue(true);
      const getMediaAccessStatus = vi.fn().mockReturnValue('granted');
      const isPackaged = true;

      if (process.platform === 'darwin' && isPackaged) {
        const micStatus = getMediaAccessStatus('microphone');
        if (micStatus !== 'granted') {
          await askForMediaAccess('microphone');
        }
      }

      expect(getMediaAccessStatus).toHaveBeenCalledWith('microphone');
      expect(askForMediaAccess).not.toHaveBeenCalled();
    });

    it('should NOT request microphone access on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const askForMediaAccess = vi.fn().mockResolvedValue(true);
      const getMediaAccessStatus = vi.fn().mockReturnValue('not-determined');
      const isPackaged = true;

      if (process.platform === 'darwin' && isPackaged) {
        const micStatus = getMediaAccessStatus('microphone');
        if (micStatus !== 'granted') {
          await askForMediaAccess('microphone');
        }
      }

      expect(getMediaAccessStatus).not.toHaveBeenCalled();
      expect(askForMediaAccess).not.toHaveBeenCalled();
    });

    it('should NOT request microphone access in dev mode', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const askForMediaAccess = vi.fn().mockResolvedValue(true);
      const getMediaAccessStatus = vi.fn().mockReturnValue('not-determined');
      const isPackaged = false;

      if (process.platform === 'darwin' && isPackaged) {
        const micStatus = getMediaAccessStatus('microphone');
        if (micStatus !== 'granted') {
          await askForMediaAccess('microphone');
        }
      }

      expect(getMediaAccessStatus).not.toHaveBeenCalled();
      expect(askForMediaAccess).not.toHaveBeenCalled();
    });
  });

  describe('Automation Permission (System Events)', () => {
    it('should trigger osascript test call when not trusted on macOS packaged', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const isTrustedAccessibilityClient = vi.fn().mockReturnValue(false);
      const exec = vi.fn();
      const isPackaged = true;

      if (process.platform === 'darwin' && isPackaged) {
        const automationAllowed = isTrustedAccessibilityClient(false);
        if (!automationAllowed) {
          exec('osascript -e \'tell application "System Events" to return name of first process whose frontmost is true\'');
        }
      }

      expect(isTrustedAccessibilityClient).toHaveBeenCalledWith(false);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('osascript')
      );
    });

    it('should NOT trigger osascript when already trusted', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const isTrustedAccessibilityClient = vi.fn().mockReturnValue(true);
      const exec = vi.fn();
      const isPackaged = true;

      if (process.platform === 'darwin' && isPackaged) {
        const automationAllowed = isTrustedAccessibilityClient(false);
        if (!automationAllowed) {
          exec('osascript ...');
        }
      }

      expect(isTrustedAccessibilityClient).toHaveBeenCalledWith(false);
      expect(exec).not.toHaveBeenCalled();
    });

    it('should NOT check automation on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const isTrustedAccessibilityClient = vi.fn().mockReturnValue(false);
      const exec = vi.fn();
      const isPackaged = true;

      if (process.platform === 'darwin' && isPackaged) {
        const automationAllowed = isTrustedAccessibilityClient(false);
        if (!automationAllowed) {
          exec('osascript ...');
        }
      }

      expect(isTrustedAccessibilityClient).not.toHaveBeenCalled();
      expect(exec).not.toHaveBeenCalled();
    });
  });
});

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app, safeStorage } from 'electron';

/**
 * Custom storage adapter for Supabase in Electron main process.
 * Uses Electron's safeStorage API (OS keychain / DPAPI) to encrypt session
 * data at rest on Windows. On macOS, plaintext JSON is used because ad-hoc
 * code signing causes Keychain prompts on every launch when the binary hash
 * changes between builds.
 */
export class ElectronStorageAdapter {
  private storagePath: string;
  private legacyPath: string;
  private encrypted: boolean;

  constructor() {
    const userDataPath = app.getPath('userData');
    const storageDir = join(userDataPath, '.supabase');

    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }

    // macOS + ad-hoc signing = Keychain prompts on every launch.
    // DPAPI on Windows doesn't have this problem, so encrypt only there.
    this.encrypted = process.platform !== 'darwin' && safeStorage.isEncryptionAvailable();
    this.storagePath = join(storageDir, this.encrypted ? 'session.enc' : 'session.json');
    this.legacyPath = join(storageDir, this.encrypted ? 'session.json' : 'session.enc');

    // On macOS: delete old encrypted file to avoid any Keychain interaction.
    // User will simply need to log in again after upgrading from an encrypted build.
    if (!this.encrypted && existsSync(join(storageDir, 'session.enc'))) {
      try {
        unlinkSync(join(storageDir, 'session.enc'));
        console.log('[ElectronStorageAdapter] Removed old encrypted session (macOS ad-hoc migration)');
      } catch {
        // Non-fatal
      }
    }

    // Migrate from plaintext → encrypted on Windows
    if (this.encrypted && existsSync(this.legacyPath) && !existsSync(this.storagePath)) {
      try {
        const plaintext = readFileSync(this.legacyPath, 'utf-8');
        JSON.parse(plaintext);
        writeFileSync(this.storagePath, safeStorage.encryptString(plaintext));
        unlinkSync(this.legacyPath);
        console.log('[ElectronStorageAdapter] Migrated plaintext session to encrypted storage');
      } catch {
        // Migration failure is non-fatal
      }
    }

    console.log('[ElectronStorageAdapter] Storage path:', this.storagePath, this.encrypted ? '(encrypted/DPAPI)' : '(plaintext)');
  }

  private readStore(): Record<string, string> {
    if (!existsSync(this.storagePath)) return {};
    try {
      if (this.encrypted) {
        const buf = readFileSync(this.storagePath);
        return JSON.parse(safeStorage.decryptString(buf));
      }
      return JSON.parse(readFileSync(this.storagePath, 'utf-8'));
    } catch {
      return {};
    }
  }

  private writeStore(data: Record<string, string>): void {
    const json = JSON.stringify(data, null, 2);
    if (this.encrypted) {
      writeFileSync(this.storagePath, safeStorage.encryptString(json));
    } else {
      writeFileSync(this.storagePath, json, 'utf-8');
    }
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const data = this.readStore();
      return data[key] || null;
    } catch (error) {
      console.error('[ElectronStorageAdapter] Error reading session:', error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const data = this.readStore();
      data[key] = value;
      this.writeStore(data);
    } catch (error) {
      console.error('[ElectronStorageAdapter] Error saving session:', error);
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      const data = this.readStore();
      delete data[key];
      this.writeStore(data);
    } catch (error) {
      console.error('[ElectronStorageAdapter] Error removing session:', error);
      throw error;
    }
  }
}

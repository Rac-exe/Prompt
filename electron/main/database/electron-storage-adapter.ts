import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app, safeStorage } from 'electron';

/**
 * Custom storage adapter for Supabase in Electron main process.
 * Uses Electron's safeStorage API (OS keychain / DPAPI) to encrypt session
 * data at rest. Falls back to plaintext if safeStorage is unavailable.
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

    this.encrypted = safeStorage.isEncryptionAvailable();
    this.storagePath = join(storageDir, this.encrypted ? 'session.enc' : 'session.json');
    this.legacyPath = join(storageDir, 'session.json');

    // One-time migration: encrypt existing plaintext session.json
    if (this.encrypted && existsSync(this.legacyPath) && !existsSync(this.storagePath)) {
      try {
        const plaintext = readFileSync(this.legacyPath, 'utf-8');
        JSON.parse(plaintext); // validate before migrating
        writeFileSync(this.storagePath, safeStorage.encryptString(plaintext));
        unlinkSync(this.legacyPath);
        console.log('[ElectronStorageAdapter] Migrated plaintext session to encrypted storage');
      } catch {
        // Migration failure is non-fatal — we'll start fresh
      }
    }

    console.log('[ElectronStorageAdapter] Storage path:', this.storagePath, this.encrypted ? '(encrypted)' : '(plaintext)');
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

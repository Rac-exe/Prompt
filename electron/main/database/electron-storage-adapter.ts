import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

/**
 * Custom storage adapter for Supabase in Electron main process
 * Persists session to filesystem since localStorage is not available
 */
export class ElectronStorageAdapter {
  private storagePath: string;

  constructor() {
    // Store in Electron's userData directory
    const userDataPath = app.getPath('userData');
    const storageDir = join(userDataPath, '.supabase');

    // Create directory if it doesn't exist
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }

    this.storagePath = join(storageDir, 'session.json');
    console.log('[ElectronStorageAdapter] Storage path:', this.storagePath);
  }

  async getItem(key: string): Promise<string | null> {
    try {
      if (!existsSync(this.storagePath)) {
        console.log('[ElectronStorageAdapter] No session file found');
        return null;
      }

      const data = readFileSync(this.storagePath, 'utf-8');
      const parsed = JSON.parse(data);
      const value = parsed[key] || null;

      // console.log('[ElectronStorageAdapter] getItem:', key, value ? 'found' : 'not found');
      return value;
    } catch (error) {
      console.error('[ElectronStorageAdapter] Error reading session:', error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      let data: Record<string, string> = {};

      // Read existing data
      if (existsSync(this.storagePath)) {
        const existing = readFileSync(this.storagePath, 'utf-8');
        data = JSON.parse(existing);
      }

      // Update key
      data[key] = value;

      // Write to file
      writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
      // console.log('[ElectronStorageAdapter] setItem:', key, 'saved');
    } catch (error) {
      console.error('[ElectronStorageAdapter] Error saving session:', error);
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      if (!existsSync(this.storagePath)) {
        return;
      }

      const data = JSON.parse(readFileSync(this.storagePath, 'utf-8'));
      delete data[key];

      writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
      // console.log('[ElectronStorageAdapter] removeItem:', key, 'removed');
    } catch (error) {
      console.error('[ElectronStorageAdapter] Error removing session:', error);
      throw error;
    }
  }
}

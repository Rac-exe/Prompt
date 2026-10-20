/**
 * Persistent error log — lightweight append-only file on disk.
 *
 * Purpose: capture non-fatal errors (e.g. overlay fire-and-forget DB saves,
 * file upload failures) that would otherwise be silent after an app restart.
 *
 * File: {userData}/error-log.json  (capped at MAX_ENTRIES entries)
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

const MAX_ENTRIES = 200;

export interface ErrorLogEntry {
  ts: string;         // ISO timestamp
  context: string;    // e.g. '[Overlay] DB save'
  message: string;
  details?: string;   // stack trace or extra info
}

export class ErrorLog {
  private logPath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.logPath = join(userDataPath, 'error-log.json');
  }

  private read(): ErrorLogEntry[] {
    try {
      if (!existsSync(this.logPath)) return [];
      return JSON.parse(readFileSync(this.logPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private write(entries: ErrorLogEntry[]): void {
    try {
      writeFileSync(this.logPath, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (err) {
      console.error('[ErrorLog] Failed to write error log:', err);
    }
  }

  append(context: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const details = err instanceof Error ? err.stack : undefined;
    const entry: ErrorLogEntry = { ts: new Date().toISOString(), context, message, details };

    // Also log to console so it shows up in Electron DevTools
    console.error(`[ErrorLog] ${context}: ${message}`);

    const entries = this.read();
    entries.push(entry);
    // Keep at most MAX_ENTRIES — drop oldest
    this.write(entries.slice(-MAX_ENTRIES));
  }

  getAll(): ErrorLogEntry[] {
    return this.read();
  }

  clear(): void {
    this.write([]);
  }
}

// Singleton
export const errorLog = new ErrorLog();

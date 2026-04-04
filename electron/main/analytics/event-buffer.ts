import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { SupabaseClientManager } from '../database/supabase-client';
import type { AnalyticsEvent } from '../types/user-types';

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_THRESHOLD = 50;

/**
 * EventBuffer — in-memory queue for analytics events.
 *
 * Accumulates events in an array and flushes them to Supabase as a
 * single batch INSERT on a timer (every 10 s) or when the buffer
 * reaches 50 events.  If the flush fails (offline, network error),
 * events are persisted to a per-user JSON file on disk and retried
 * on the next flush cycle.
 */
export class EventBuffer {
  private buffer: AnalyticsEvent[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private userId: string;
  private _cacheDir: string | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  private get cacheDir(): string {
    if (!this._cacheDir) {
      const userDataPath = app.getPath('userData');
      this._cacheDir = join(userDataPath, 'offline-cache');
      if (!existsSync(this._cacheDir)) {
        mkdirSync(this._cacheDir, { recursive: true });
      }
    }
    return this._cacheDir;
  }

  private get offlinePath(): string {
    return join(this.cacheDir, `analytics-${this.userId}.json`);
  }

  push(event: AnalyticsEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= FLUSH_THRESHOLD) {
      this.flush().catch(() => {});
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);

    try {
      const client = SupabaseClientManager.getClient();
      const { error } = await client.from('usage_events').insert(batch);

      if (error) {
        console.error('[EventBuffer] Supabase insert failed:', error.message);
        this.persistToOfflineCache(batch);
      }
    } catch (err) {
      console.error('[EventBuffer] Flush failed:', err instanceof Error ? err.message : err);
      this.persistToOfflineCache(batch);
    }
  }

  async flushSync(): Promise<void> {
    await this.flush();
  }

  startAutoFlush(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.flush().catch(() => {});
    }, FLUSH_INTERVAL_MS);
  }

  stopAutoFlush(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async drainOfflineQueue(): Promise<void> {
    const filePath = this.offlinePath;
    if (!existsSync(filePath)) return;

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const events: AnalyticsEvent[] = JSON.parse(raw);

      if (!Array.isArray(events) || events.length === 0) {
        unlinkSync(filePath);
        return;
      }

      const client = SupabaseClientManager.getClient();
      const { error } = await client.from('usage_events').insert(events);

      if (error) {
        console.warn('[EventBuffer] Offline drain failed — will retry next cycle:', error.message);
        return;
      }

      unlinkSync(filePath);
      console.log(`[EventBuffer] Drained ${events.length} offline events`);
    } catch (err) {
      console.warn('[EventBuffer] Failed to read offline queue:', err instanceof Error ? err.message : err);
    }
  }

  private persistToOfflineCache(events: AnalyticsEvent[]): void {
    try {
      let existing: AnalyticsEvent[] = [];
      const filePath = this.offlinePath;

      if (existsSync(filePath)) {
        try {
          existing = JSON.parse(readFileSync(filePath, 'utf-8'));
          if (!Array.isArray(existing)) existing = [];
        } catch {
          existing = [];
        }
      }

      const merged = existing.concat(events);
      writeFileSync(filePath, JSON.stringify(merged), 'utf-8');
      console.log(`[EventBuffer] Persisted ${events.length} events to offline cache (total: ${merged.length})`);
    } catch (err) {
      console.error('[EventBuffer] Failed to persist to offline cache:', err instanceof Error ? err.message : err);
    }
  }
}

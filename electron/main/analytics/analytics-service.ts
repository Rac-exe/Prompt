import { SupabaseClientManager } from '../database/supabase-client';
import { EventBuffer } from './event-buffer';
import { ANALYTICS_EVENT_TYPES, type AnalyticsEventType, type AnalyticsEvent } from '../types/user-types';

const VALID_EVENT_TYPES = new Set<string>(ANALYTICS_EVENT_TYPES);

/**
 * AnalyticsService — singleton that manages app session tracking and
 * usage event logging.
 *
 * All public methods are designed to never throw — analytics must
 * never break the user-facing app flow.
 */
class AnalyticsService {
  private userId: string | null = null;
  private sessionId: string | null = null;
  private sessionStartedAt: number | null = null;
  private buffer: EventBuffer | null = null;
  private initialized = false;

  initialize(userId: string): void {
    if (this.initialized && this.userId === userId) return;

    this.userId = userId;
    this.buffer = new EventBuffer(userId);
    this.buffer.startAutoFlush();
    this.initialized = true;

    this.buffer.drainOfflineQueue().catch((err) => {
      console.warn('[AnalyticsService] Offline queue drain failed:', err instanceof Error ? err.message : err);
    });

    console.log('[AnalyticsService] Initialized for user:', userId);
  }

  async startSession(appVersion: string): Promise<void> {
    if (!this.initialized || !this.userId) return;

    try {
      const client = SupabaseClientManager.getClient();
      const { data, error } = await client
        .from('app_sessions')
        .insert({
          user_id: this.userId,
          app_version: appVersion,
          platform: process.platform,
        })
        .select('id')
        .single();

      if (error) {
        console.error('[AnalyticsService] Failed to start session:', error.message);
        return;
      }

      this.sessionId = data.id;
      this.sessionStartedAt = Date.now();
      console.log('[AnalyticsService] Session started:', this.sessionId);
    } catch (err) {
      console.error('[AnalyticsService] startSession error:', err instanceof Error ? err.message : err);
    }
  }

  async endSession(): Promise<void> {
    if (!this.sessionId || !this.userId) return;

    try {
      const durationSeconds = this.sessionStartedAt
        ? Math.round((Date.now() - this.sessionStartedAt) / 1000)
        : null;

      const client = SupabaseClientManager.getClient();
      const { error } = await client
        .from('app_sessions')
        .update({
          ended_at: new Date().toISOString(),
          duration_seconds: durationSeconds,
        })
        .eq('id', this.sessionId)
        .eq('user_id', this.userId);

      if (error) {
        console.error('[AnalyticsService] Failed to end session:', error.message);
        return;
      }

      console.log(`[AnalyticsService] Session ended: ${this.sessionId} (${durationSeconds}s)`);
      this.sessionId = null;
      this.sessionStartedAt = null;
    } catch (err) {
      console.error('[AnalyticsService] endSession error:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Log a usage event. Fire-and-forget — never throws, never blocks.
   */
  logEvent(type: AnalyticsEventType, metadata?: Record<string, unknown>): void {
    if (!this.initialized || !this.userId || !this.buffer) return;

    if (!VALID_EVENT_TYPES.has(type)) {
      console.warn(`[AnalyticsService] Unknown event type dropped: ${type}`);
      return;
    }

    const event: AnalyticsEvent = {
      user_id: this.userId,
      event_type: type,
      metadata: metadata ?? {},
      created_at: new Date().toISOString(),
    };

    this.buffer.push(event);
  }

  async shutdown(): Promise<void> {
    try {
      await this.endSession();
    } catch {
      // Best-effort
    }

    if (this.buffer) {
      try {
        await this.buffer.flushSync();
      } catch {
        // Best-effort
      }
      this.buffer.stopAutoFlush();
    }

    this.initialized = false;
    console.log('[AnalyticsService] Shutdown complete');
  }
}

export const analyticsService = new AnalyticsService();

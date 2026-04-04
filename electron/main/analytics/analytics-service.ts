import * as Sentry from '@sentry/electron/main';
import { logger } from '@sentry/core';
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

    Sentry.addBreadcrumb({ category: 'analytics', message: 'Analytics initialized', level: 'info', data: { userId } });
    logger.info(logger.fmt`analytics.initialized userId=${userId}`);

    this.buffer.drainOfflineQueue().catch((err) => {
      Sentry.captureException(err, { level: 'warning', tags: { component: 'analytics', operation: 'drain-offline' } });
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
        Sentry.addBreadcrumb({ category: 'analytics', message: 'Session start failed', level: 'error', data: { error: error.message } });
        Sentry.captureMessage('Analytics session start failed: ' + error.message, 'warning');
        console.error('[AnalyticsService] Failed to start session:', error.message);
        return;
      }

      this.sessionId = data.id;
      this.sessionStartedAt = Date.now();
      Sentry.setTag('analytics_session', this.sessionId);
      Sentry.addBreadcrumb({ category: 'analytics', message: 'Session started', level: 'info', data: { sessionId: this.sessionId, appVersion } });
      logger.info(logger.fmt`analytics.session_started sessionId=${this.sessionId} appVersion=${appVersion} platform=${process.platform}`);
      console.log('[AnalyticsService] Session started:', this.sessionId);
    } catch (err) {
      Sentry.captureException(err, { level: 'warning', tags: { component: 'analytics', operation: 'start-session' } });
      console.error('[AnalyticsService] startSession error:', err instanceof Error ? err.message : err);
    }
  }

  async endSession(): Promise<void> {
    if (!this.sessionId || !this.userId) return;

    const sessionId = this.sessionId;
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
        Sentry.addBreadcrumb({ category: 'analytics', message: 'Session end failed', level: 'error', data: { sessionId, error: error.message } });
        Sentry.captureMessage('Analytics session end failed: ' + error.message, 'warning');
        console.error('[AnalyticsService] Failed to end session:', error.message);
        return;
      }

      Sentry.addBreadcrumb({ category: 'analytics', message: 'Session ended', level: 'info', data: { sessionId, durationSeconds } });
      logger.info(logger.fmt`analytics.session_ended sessionId=${sessionId} durationSeconds=${durationSeconds ?? 0}`);
      console.log(`[AnalyticsService] Session ended: ${sessionId} (${durationSeconds}s)`);
      this.sessionId = null;
      this.sessionStartedAt = null;
    } catch (err) {
      Sentry.captureException(err, { level: 'warning', tags: { component: 'analytics', operation: 'end-session' }, extra: { sessionId } });
      console.error('[AnalyticsService] endSession error:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Log a usage event. Fire-and-forget — never throws, never blocks.
   */
  logEvent(type: AnalyticsEventType, metadata?: Record<string, unknown>): void {
    if (!this.initialized || !this.userId || !this.buffer) return;

    if (!VALID_EVENT_TYPES.has(type)) {
      Sentry.addBreadcrumb({ category: 'analytics', message: 'Unknown event type dropped', level: 'warning', data: { type } });
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
    Sentry.addBreadcrumb({ category: 'analytics', message: `Event logged: ${type}`, level: 'info', data: { type, ...metadata } });
  }

  async shutdown(): Promise<void> {
    Sentry.addBreadcrumb({ category: 'analytics', message: 'Analytics shutting down', level: 'info' });

    try {
      await this.endSession();
    } catch {
      // Best-effort — already captured in endSession
    }

    if (this.buffer) {
      try {
        await this.buffer.flushSync();
      } catch {
        // Best-effort — already captured in flush
      }
      this.buffer.stopAutoFlush();
    }

    this.initialized = false;
    logger.info('analytics.shutdown_complete');
    console.log('[AnalyticsService] Shutdown complete');
  }
}

export const analyticsService = new AnalyticsService();

import * as Sentry from '@sentry/electron/main';
import { SupabaseClientManager } from '../supabase-client';

export type DeletionStatus = 'pending' | 'completed' | 'cancelled';

export interface DeletionRequest {
  id: string;
  user_id: string;
  requested_at: string;
  scheduled_deletion_at: string;
  status: DeletionStatus;
  reason?: string | null;
}

/**
 * DeletionService — handles GDPR Article 17 "Right to Erasure" requests.
 *
 * Flow (Option C — hard lockout):
 *   1. requestDeletion() invokes the SECURITY DEFINER RPC `request_account_deletion`.
 *      The RPC atomically inserts a pending deletion_request AND sets
 *      auth.users.banned_until = NOW() + 30 days. After this call the user
 *      can no longer sign in via any provider (password / Google / GitHub).
 *   2. The Edge Function `process-deletions` runs daily and physically wipes
 *      Cloudinary assets, Storage objects, and the auth.users row (CASCADE).
 *   3. Restoration is OUT OF BAND: the renderer never holds the privileges to
 *      cancel a deletion. The Python service `/account/confirm-restore` flow
 *      does it via service-role RPC after OTP verification.
 *
 * No `cancelDeletion()` exists on this service by design — once requested,
 * the only way back is via OTP-verified restore from the login screen.
 *
 * Sentry: both methods are wrapped in spans + capture so the GDPR-critical
 * RPC + view query failures are first-class events on the dashboard.
 */
export class DeletionService {
  private client = SupabaseClientManager.getClient();

  /**
   * Submit a deletion request for the currently authenticated user.
   * Throws if a request is already pending or the RPC fails.
   */
  async requestDeletion(reason?: string): Promise<DeletionRequest> {
    return Sentry.startSpan(
      {
        name: 'gdpr.request-deletion',
        op: 'auth.supabase',
        attributes: { has_reason: !!reason },
      },
      async (span) => {
        try {
          const { data, error } = await this.client.rpc('request_account_deletion', {
            p_reason: reason ?? null,
          });

          if (error) {
            span.setAttribute('result', 'rpc-error');
            span.setAttribute('error_code', error.code ?? 'unknown');
            console.error('[DeletionService] RPC request_account_deletion failed:', error);
            const wrapped = new Error(error.message || 'Failed to request account deletion');
            Sentry.captureException(wrapped, {
              tags: { component: 'deletion-service', op: 'request-deletion', failure: 'rpc' },
              extra: { supabase_error_code: error.code, supabase_error_details: error.details },
            });
            throw wrapped;
          }
          if (!data) {
            span.setAttribute('result', 'no-data');
            const wrapped = new Error('Failed to request account deletion');
            Sentry.captureException(wrapped, {
              tags: { component: 'deletion-service', op: 'request-deletion', failure: 'empty-response' },
            });
            throw wrapped;
          }

          const req = data as DeletionRequest;
          span.setAttribute('result', 'success');
          span.setAttribute('userId', req.user_id);
          span.setAttribute('scheduled_deletion_at', req.scheduled_deletion_at);
          console.log(`[DeletionService] Deletion requested for user ${req.user_id}. ` +
            `Scheduled: ${req.scheduled_deletion_at}`);
          return req;
        } catch (err) {
          // Re-throw Errors we already captured above; capture anything else
          // (network, JSON parse, unexpected runtime) once before rethrowing.
          if (!(err instanceof Error) || !err.message.includes('account deletion')) {
            Sentry.captureException(err, {
              tags: { component: 'deletion-service', op: 'request-deletion', failure: 'unexpected' },
            });
          }
          throw err;
        }
      },
    );
  }

  /**
   * Get the current pending deletion request for the authenticated user, or null.
   * Reads via the user-scoped `my_pending_deletion` view.
   */
  async getPendingRequest(): Promise<DeletionRequest | null> {
    return Sentry.startSpan(
      { name: 'gdpr.get-pending-request', op: 'auth.supabase' },
      async (span) => {
        try {
          const { data, error } = await this.client
            .from('my_pending_deletion')
            .select('*')
            .order('requested_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) {
            span.setAttribute('result', 'query-error');
            console.error('[DeletionService] Failed to fetch pending request:', error);
            // Non-fatal: status check failures degrade to "no pending request" for the
            // UI but should still show up on Sentry so we can spot view/RLS regressions.
            Sentry.captureException(error, {
              level: 'warning',
              tags: { component: 'deletion-service', op: 'get-pending-request' },
            });
            return null;
          }

          span.setAttribute('result', data ? 'pending' : 'none');
          return data as DeletionRequest | null;
        } catch (err) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(err, {
            level: 'warning',
            tags: { component: 'deletion-service', op: 'get-pending-request', failure: 'unexpected' },
          });
          console.error('[DeletionService] Unexpected pending-request error:', err);
          return null;
        }
      },
    );
  }
}

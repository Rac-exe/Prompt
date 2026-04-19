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
 */
export class DeletionService {
  private client = SupabaseClientManager.getClient();

  /**
   * Submit a deletion request for the currently authenticated user.
   * Throws if a request is already pending or the RPC fails.
   */
  async requestDeletion(reason?: string): Promise<DeletionRequest> {
    const { data, error } = await this.client.rpc('request_account_deletion', {
      p_reason: reason ?? null,
    });

    if (error) {
      console.error('[DeletionService] RPC request_account_deletion failed:', error);
      throw new Error(error.message || 'Failed to request account deletion');
    }
    if (!data) {
      throw new Error('Failed to request account deletion');
    }

    const req = data as DeletionRequest;
    console.log(`[DeletionService] Deletion requested for user ${req.user_id}. ` +
      `Scheduled: ${req.scheduled_deletion_at}`);
    return req;
  }

  /**
   * Get the current pending deletion request for the authenticated user, or null.
   * Reads via the user-scoped `my_pending_deletion` view.
   */
  async getPendingRequest(): Promise<DeletionRequest | null> {
    const { data, error } = await this.client
      .from('my_pending_deletion')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[DeletionService] Failed to fetch pending request:', error);
      return null;
    }
    return data as DeletionRequest | null;
  }
}

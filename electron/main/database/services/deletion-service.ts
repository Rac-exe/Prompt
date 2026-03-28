import { SupabaseClientManager } from '../supabase-client';

export type DeletionStatus = 'pending' | 'completed' | 'cancelled';

export interface DeletionRequest {
  id: string;
  user_id: string;
  requested_at: string;
  scheduled_deletion_at: string;   // requested_at + 30 days
  status: DeletionStatus;
  reason?: string | null;
}

const DELETION_DELAY_DAYS = 30;

/**
 * DeletionService — handles GDPR Article 17 "Right to Erasure" requests.
 *
 * When a user requests account deletion:
 *   1. A row is inserted into `deletion_requests` with status='pending'.
 *   2. `scheduled_deletion_at` is set to NOW + 30 days — not one day before.
 *   3. A Supabase cron job / Edge Function is responsible for processing rows
 *      where status='pending' AND scheduled_deletion_at <= NOW().
 *   4. Users can cancel a pending request before the 30-day window closes.
 *
 * The actual data wipe (chats, messages, memory, feedback, uploads, auth user)
 * is performed server-side by a Supabase Edge Function named `process-deletions`
 * so that no client-side code ever holds service-role credentials.
 */
export class DeletionService {
  private client = SupabaseClientManager.getClient();

  /**
   * Submit a deletion request for the currently authenticated user.
   * Returns the created DeletionRequest, or throws if one is already pending.
   */
  async requestDeletion(reason?: string): Promise<DeletionRequest> {
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) throw new Error('Not authenticated');
    const userId = userData.user.id;

    // Check for an existing pending request
    const existing = await this.getPendingRequest();
    if (existing) {
      throw new Error('A deletion request is already pending. It will be processed on ' +
        new Date(existing.scheduled_deletion_at).toLocaleDateString());
    }

    const requestedAt = new Date();
    const scheduledAt = new Date(requestedAt);
    scheduledAt.setUTCDate(scheduledAt.getUTCDate() + DELETION_DELAY_DAYS);

    const { data, error } = await this.client
      .from('deletion_requests')
      .insert({
        user_id: userId,
        requested_at: requestedAt.toISOString(),
        scheduled_deletion_at: scheduledAt.toISOString(),
        status: 'pending' as DeletionStatus,
        reason: reason ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('[DeletionService] Failed to create deletion request:', error);
      throw error;
    }

    console.log(`[DeletionService] Deletion request created for user ${userId}. ` +
      `Scheduled: ${scheduledAt.toISOString()}`);

    return data as DeletionRequest;
  }

  /**
   * Cancel an existing pending deletion request.
   * Returns the cancelled request, or throws if none found.
   */
  async cancelDeletion(): Promise<DeletionRequest> {
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) throw new Error('Not authenticated');
    const userId = userData.user.id;

    const { data, error } = await this.client
      .from('deletion_requests')
      .update({ status: 'cancelled' as DeletionStatus })
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !data) {
      throw new Error('No pending deletion request found to cancel.');
    }

    console.log(`[DeletionService] Deletion request cancelled for user ${userId}`);
    return data as DeletionRequest;
  }

  /**
   * Get the current pending deletion request for the authenticated user, or null.
   */
  async getPendingRequest(): Promise<DeletionRequest | null> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) return null;

    const { data, error } = await this.client
      .from('deletion_requests')
      .select('*')
      .eq('user_id', userData.user.id)
      .eq('status', 'pending')
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

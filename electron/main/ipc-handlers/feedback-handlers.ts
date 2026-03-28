import { ipcMain } from 'electron';
import { SupabaseClientManager } from '../database/supabase-client';

export function registerFeedbackHandlers(): void {
    ipcMain.handle('feedback:submit', async (_event, data: { rating: 'positive' | 'negative'; comment?: string }) => {
        try {
            const client = SupabaseClientManager.getClient();
            const { data: userData, error: authError } = await client.auth.getUser();

            if (authError || !userData.user) {
                return { success: false, error: 'Not authenticated' };
            }

            const { error } = await client.from('user_feedback').insert({
                user_id: userData.user.id,
                rating: data.rating,
                comment: data.comment ?? null,
            });

            if (error) {
                console.error('[Feedback] Failed to save feedback:', error.message);
                return { success: false, error: error.message };
            }

            console.log('[Feedback] Feedback saved:', data.rating);
            return { success: true };
        } catch (err: any) {
            console.error('[Feedback] Unexpected error:', err.message);
            return { success: false, error: 'Failed to save feedback' };
        }
    });

    console.log('[FeedbackHandlers] IPC handlers registered');
}

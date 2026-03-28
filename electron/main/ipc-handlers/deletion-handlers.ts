import { ipcMain } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { DeletionService } from '../database/services/deletion-service';

/**
 * IPC handlers for GDPR account deletion requests.
 *
 * Channels exposed:
 *   deletion:request  — invoke — submit a new 30-day deferred deletion
 *   deletion:cancel   — invoke — cancel a pending deletion request
 *   deletion:status   — invoke — get the current pending request (or null)
 */
export function registerDeletionHandlers(): void {
  const svc = new DeletionService();

  ipcMain.handle('deletion:request', async (_event, reason?: string) => {
    try {
      const req = await svc.requestDeletion(reason);
      Sentry.addBreadcrumb({
        category: 'gdpr',
        message: 'Account deletion requested',
        level: 'warning',
        data: { scheduled_deletion_at: req.scheduled_deletion_at },
      });
      return {
        success: true,
        scheduledAt: req.scheduled_deletion_at,
        message: `Your account and all associated data will be permanently deleted on ` +
          `${new Date(req.scheduled_deletion_at).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
          })}. You can cancel this request any time before that date in Settings.`,
      };
    } catch (err: any) {
      Sentry.captureException(err, { tags: { component: 'gdpr-deletion' } });
      console.error('[DeletionHandler] Request failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('deletion:cancel', async () => {
    try {
      const req = await svc.cancelDeletion();
      Sentry.addBreadcrumb({
        category: 'gdpr',
        message: 'Account deletion cancelled',
        level: 'info',
      });
      return { success: true, cancelledAt: req.scheduled_deletion_at };
    } catch (err: any) {
      Sentry.captureException(err, { tags: { component: 'gdpr-deletion' } });
      console.error('[DeletionHandler] Cancel failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('deletion:status', async () => {
    try {
      const req = await svc.getPendingRequest();
      return { pending: !!req, request: req };
    } catch (err: any) {
      console.error('[DeletionHandler] Status check failed:', err.message);
      return { pending: false, request: null };
    }
  });

  console.log('[DeletionHandlers] IPC handlers registered');
}

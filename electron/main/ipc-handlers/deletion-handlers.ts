import { ipcMain, BrowserWindow } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { DeletionService } from '../database/services/deletion-service';
import { SupabaseClientManager } from '../database/supabase-client';
import { emailService } from '../services/email-service';

/**
 * IPC handlers for the GDPR account-deletion flow (Option C — hard lockout).
 *
 * Channels exposed:
 *   deletion:request           — invoke({reason}) → atomic RPC: pending row + ban user
 *                                After success the main process force-signs-out
 *                                so the renderer can never observe the locked-out state.
 *   deletion:status            — invoke()         → { pending, request|null }
 *   deletion:restore-request   — invoke({email})  → email an OTP to verify ownership
 *   deletion:restore-confirm   — invoke({email,otp}) → cancel deletion + lift ban
 *
 * There is no `deletion:cancel` — restore is intentionally OUT OF BAND and requires
 * possession of the account email.
 */
export function registerDeletionHandlers(): void {
  const svc = new DeletionService();

  ipcMain.handle('deletion:request', async (_event, payload: { reason?: string } | string | undefined) => {
    const reason = typeof payload === 'string' ? payload : payload?.reason;
    return Sentry.startSpan(
      { name: 'ipc.deletion-request', op: 'ipc', attributes: { has_reason: !!reason } },
      async (span) => {
        try {
          const req = await svc.requestDeletion(reason);

          span.setAttribute('result', 'rpc-success');
          span.setAttribute('scheduled_deletion_at', req.scheduled_deletion_at);

          Sentry.addBreadcrumb({
            category: 'gdpr',
            message: 'Account deletion requested',
            level: 'warning',
            data: { scheduled_deletion_at: req.scheduled_deletion_at },
          });

          // Force sign-out so the now-banned session cannot be used.
          try {
            await SupabaseClientManager.getClient().auth.signOut();
            span.setAttribute('forced_signout', 'success');
          } catch (err) {
            // Non-fatal — the user is banned regardless, but signal it on the dashboard.
            span.setAttribute('forced_signout', 'failed');
            Sentry.captureException(err, {
              level: 'warning',
              tags: { component: 'gdpr-deletion', op: 'request.force-signout' },
            });
            console.warn('[DeletionHandler] signOut after deletion failed (non-fatal):', err);
          }

          // Notify all renderers — they should route to the login screen.
          let notifiedWindows = 0;
          for (const w of BrowserWindow.getAllWindows()) {
            try {
              w.webContents.send('auth:state-changed', { isAuthenticated: false, user: null });
              w.webContents.send('deletion:requested', { scheduledAt: req.scheduled_deletion_at });
              notifiedWindows++;
            } catch { /* ignore broken windows */ }
          }
          span.setAttribute('notified_windows', notifiedWindows);
          span.setAttribute('result', 'success');

          return {
            success: true,
            scheduledAt: req.scheduled_deletion_at,
            message:
              `Your account is scheduled for permanent deletion on ${
                new Date(req.scheduled_deletion_at).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })
              }. You won't be able to sign in during this period. To cancel, use "Restore deleted account" on the sign-in screen within the next 30 days.`,
          };
        } catch (err: any) {
          span.setAttribute('result', 'error');
          Sentry.captureException(err, { tags: { component: 'gdpr-deletion', op: 'request' } });
          console.error('[DeletionHandler] Request failed:', err.message);
          return { success: false, error: err.message || 'Failed to request account deletion.' };
        }
      },
    );
  });

  ipcMain.handle('deletion:status', async () => {
    return Sentry.startSpan(
      { name: 'ipc.deletion-status', op: 'ipc' },
      async (span) => {
        try {
          const req = await svc.getPendingRequest();
          span.setAttribute('pending', !!req);
          return { pending: !!req, request: req };
        } catch (err: any) {
          // Status checks are non-fatal — degrade silently for the UI.
          span.setAttribute('result', 'error');
          Sentry.captureException(err, {
            level: 'warning',
            tags: { component: 'gdpr-deletion', op: 'status' },
          });
          console.error('[DeletionHandler] Status check failed:', err.message);
          return { pending: false, request: null };
        }
      },
    );
  });

  ipcMain.handle('deletion:restore-request', async (_event, payload: { email: string }) => {
    return Sentry.startSpan(
      { name: 'ipc.deletion-restore-request', op: 'ipc' },
      async (span) => {
        try {
          const email = payload?.email?.trim();
          if (!email) {
            span.setAttribute('result', 'invalid-input');
            return { success: false, error: 'Email is required.' };
          }
          span.setAttribute('email', email);
          const result = await emailService.sendRestoreOtp(email);
          span.setAttribute('result', result.success ? 'success' : 'failed');
          Sentry.addBreadcrumb({
            category: 'gdpr',
            message: 'Restore OTP requested',
            level: 'info',
            data: { ok: result.success },
          });
          return result;
        } catch (err: any) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(err, { tags: { component: 'gdpr-deletion', op: 'restore-request' } });
          return { success: false, error: 'Could not send restore email. Please try again.' };
        }
      },
    );
  });

  ipcMain.handle('deletion:restore-confirm', async (_event, payload: { email: string; otp: string }) => {
    return Sentry.startSpan(
      { name: 'ipc.deletion-restore-confirm', op: 'ipc' },
      async (span) => {
        try {
          const email = payload?.email?.trim();
          const otp = payload?.otp?.trim();
          if (!email || !otp) {
            span.setAttribute('result', 'invalid-input');
            return { success: false, error: 'Email and code are required.' };
          }
          span.setAttribute('email', email);
          const result = await emailService.confirmRestore(email, otp);
          span.setAttribute('result', result.success ? 'success' : 'failed');
          if (result.success) {
            Sentry.addBreadcrumb({
              category: 'gdpr',
              message: 'Account restore succeeded',
              level: 'info',
            });
          }
          return result;
        } catch (err: any) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(err, { tags: { component: 'gdpr-deletion', op: 'restore-confirm' } });
          return { success: false, error: 'Restore failed. Please try again.' };
        }
      },
    );
  });

  console.log('[DeletionHandlers] IPC handlers registered (request, status, restore-request, restore-confirm)');
}

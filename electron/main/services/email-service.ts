import * as Sentry from '@sentry/electron/main';
import { logger } from '@sentry/core';

function getBaseUrl(): string {
  const raw = (process.env.PYTHON_SERVICE_URL || '').trim();
  if (!raw) return 'http://127.0.0.1:8001';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
  } catch { /* fall through */ }
  return 'http://127.0.0.1:8001';
}

export class EmailService {
  // ── Signup OTP ──────────────────────────────────────────────────────────

  async sendSignupOtp(data: { name: string; dob: string; email: string; password: string }): Promise<{ success: boolean; error?: string }> {
    return Sentry.startSpan(
      { name: 'email.send-signup-otp', op: 'http.client', attributes: { email: data.email } },
      async (span) => {
        try {
          const res = await fetch(`${getBaseUrl()}/auth/send-signup-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });

          if (!res.ok) {
            const body: any = await res.json().catch(() => ({ detail: res.statusText }));
            span.setAttribute('success', false);
            return { success: false, error: body.detail || 'Failed to send verification email.' };
          }

          span.setAttribute('success', true);
          Sentry.addBreadcrumb({ category: 'email', message: 'Signup OTP sent via Python', level: 'info', data: { email: data.email } });
          logger.info(logger.fmt`email.signup_otp_sent email=${data.email}`);
          return { success: true };
        } catch (err: any) {
          span.setAttribute('success', false);
          Sentry.captureException(err, { tags: { component: 'email-service', op: 'sendSignupOtp' } });
          console.error('[EmailService] sendSignupOtp failed:', err);
          return { success: false, error: 'Failed to send verification email. Please try again.' };
        }
      },
    );
  }

  async verifySignupOtp(email: string, otp: string): Promise<{ valid: boolean; data?: { name: string; dob: string; email: string; password: string }; error?: string }> {
    return Sentry.startSpan(
      { name: 'email.verify-signup-otp', op: 'http.client', attributes: { email } },
      async (span) => {
        try {
          const res = await fetch(`${getBaseUrl()}/auth/verify-signup-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp }),
          });

          const body: any = await res.json();

          if (!res.ok) {
            span.setAttribute('result', 'invalid');
            return { valid: false, error: body.detail || 'Verification failed.' };
          }

          span.setAttribute('result', 'success');
          Sentry.addBreadcrumb({ category: 'email', message: 'Signup OTP verified via Python', level: 'info', data: { email } });
          logger.info(logger.fmt`email.signup_otp_verified email=${email}`);
          return { valid: true, data: body.data };
        } catch (err: any) {
          span.setAttribute('result', 'error');
          Sentry.captureException(err, { tags: { component: 'email-service', op: 'verifySignupOtp' } });
          console.error('[EmailService] verifySignupOtp failed:', err);
          return { valid: false, error: 'Verification failed. Please try again.' };
        }
      },
    );
  }

  // ── Password Reset OTP ──────────────────────────────────────────────────

  async sendResetOtp(email: string): Promise<{ success: boolean; error?: string }> {
    return Sentry.startSpan(
      { name: 'email.send-reset-otp', op: 'http.client', attributes: { email } },
      async (span) => {
        try {
          const res = await fetch(`${getBaseUrl()}/auth/send-reset-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });

          if (!res.ok) {
            const body: any = await res.json().catch(() => ({ detail: res.statusText }));
            span.setAttribute('success', false);
            return { success: false, error: body.detail || 'Failed to send reset email.' };
          }

          span.setAttribute('success', true);
          Sentry.addBreadcrumb({ category: 'email', message: 'Reset OTP sent via Python', level: 'info', data: { email } });
          logger.info(logger.fmt`email.reset_otp_sent email=${email}`);
          return { success: true };
        } catch (err: any) {
          span.setAttribute('success', false);
          Sentry.captureException(err, { tags: { component: 'email-service', op: 'sendResetOtp' } });
          console.error('[EmailService] sendResetOtp failed:', err);
          return { success: false, error: 'Failed to send reset email. Please try again.' };
        }
      },
    );
  }

  async verifyResetOtpAndResetPassword(email: string, otp: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    return Sentry.startSpan(
      { name: 'email.reset-password', op: 'http.client', attributes: { email } },
      async (span) => {
        try {
          const res = await fetch(`${getBaseUrl()}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp, new_password: newPassword }),
          });

          const body: any = await res.json().catch(() => ({ detail: res.statusText }));

          if (!res.ok) {
            span.setAttribute('result', 'failed');
            return { success: false, error: body.detail || 'Password reset failed.' };
          }

          span.setAttribute('result', 'success');
          Sentry.addBreadcrumb({ category: 'auth', message: 'Password reset via Python', level: 'info', data: { email } });
          logger.info(logger.fmt`email.password_reset_success email=${email}`);
          return { success: true };
        } catch (err: any) {
          span.setAttribute('result', 'error');
          Sentry.captureException(err, { tags: { component: 'email-service', op: 'resetPassword' } });
          console.error('[EmailService] resetPassword failed:', err);
          return { success: false, error: 'Password reset failed. Please try again.' };
        }
      },
    );
  }
}

export const emailService = new EmailService();

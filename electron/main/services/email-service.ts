import { Resend } from 'resend';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/electron/main';
import { logger } from '@sentry/core';

interface PendingOtp {
  otp: string;
  expiresAt: number;
  attempts: number;
}

interface PendingSignup {
  name: string;
  dob: string;
  email: string;
  password: string;
  otp: string;
  expiresAt: number;
  attempts: number;
}

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

export class EmailService {
  private resend: Resend | null = null;
  private pendingSignups = new Map<string, PendingSignup>();
  private pendingResets = new Map<string, PendingOtp>();
  private fromAddress: string = 'TryPrmpt <no-reply@tryprmpt.com>';

  initialize() {
    const apiKey = process.env.RESEND_API_KEY;

    Sentry.addBreadcrumb({
      category: 'email',
      message: 'EmailService.initialize called',
      level: 'info',
      data: { hasApiKey: !!apiKey },
    });

    if (!apiKey) {
      Sentry.captureMessage('RESEND_API_KEY not configured — OTP emails disabled', 'warning');
      console.warn('[EmailService] RESEND_API_KEY not configured — OTP emails will be logged to console only');
      return;
    }

    try {
      this.resend = new Resend(apiKey);
      Sentry.addBreadcrumb({
        category: 'email',
        message: 'Resend client created',
        level: 'info',
        data: { from: this.fromAddress },
      });
      Sentry.setContext('email_service', { provider: 'resend', from: this.fromAddress, initialized: true });
      logger.info(logger.fmt`email.initialized provider=resend from=${this.fromAddress}`);
      console.log('[EmailService] Resend client initialized');
    } catch (err: any) {
      Sentry.withScope((scope) => {
        scope.setTag('component', 'email-service');
        scope.setTag('op', 'initialize');
        scope.setLevel('error');
        Sentry.captureException(err);
      });
      console.error('[EmailService] Failed to create Resend client:', err);
    }
  }

  private generateOtp(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  private buildOtpHtml(otp: string, purpose: 'signup' | 'reset'): string {
    const title = purpose === 'signup' ? 'Verify Your Email' : 'Reset Your Password';
    const subtitle = purpose === 'signup'
      ? 'Enter this code to complete your sign-up'
      : 'Enter this code to reset your password';

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0">
    <tr><td align="center">
      <table width="420" cellpadding="0" cellspacing="0" style="background:#141414;border-radius:12px;border:1px solid #222;padding:40px">
        <tr><td align="center" style="padding-bottom:24px">
          <span style="font-size:28px;font-weight:700;color:#fff;letter-spacing:-0.5px">Prmpt</span>
        </td></tr>
        <tr><td align="center" style="padding-bottom:8px">
          <span style="font-size:20px;font-weight:600;color:#fff">${title}</span>
        </td></tr>
        <tr><td align="center" style="padding-bottom:28px">
          <span style="font-size:14px;color:#888">${subtitle}</span>
        </td></tr>
        <tr><td align="center" style="padding-bottom:28px">
          <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px 32px;display:inline-block">
            <span style="font-size:32px;font-weight:700;color:#10b981;letter-spacing:8px;font-family:monospace">${otp}</span>
          </div>
        </td></tr>
        <tr><td align="center" style="padding-bottom:12px">
          <span style="font-size:13px;color:#666">This code expires in 10 minutes.</span>
        </td></tr>
        <tr><td align="center">
          <span style="font-size:12px;color:#444">If you didn't request this, you can safely ignore this email.</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private async sendOtpEmail(to: string, otp: string, purpose: 'signup' | 'reset'): Promise<void> {
    const subject = purpose === 'signup'
      ? 'Prmpt – Verify your email'
      : 'Prmpt – Password reset code';

    const html = this.buildOtpHtml(otp, purpose);

    if (!this.resend) {
      Sentry.addBreadcrumb({
        category: 'email',
        message: 'sendOtpEmail skipped — no Resend client',
        level: 'warning',
        data: { to, purpose },
      });
      console.log(`[EmailService] (no Resend client) OTP for ${to}: ${otp}`);
      return;
    }

    await Sentry.startSpan(
      {
        name: 'email.send-otp',
        op: 'http.client',
        attributes: { purpose, to },
      },
      async (span) => {
        Sentry.addBreadcrumb({
          category: 'email',
          message: `Sending OTP email (${purpose})`,
          level: 'info',
          data: { to, subject, from: this.fromAddress },
        });

        const t0 = Date.now();
        const { error } = await this.resend!.emails.send({
          from: this.fromAddress,
          to,
          subject,
          html,
        });
        const elapsed = Date.now() - t0;

        span.setAttribute('resend.latency_ms', elapsed);

        if (error) {
          span.setAttribute('resend.error', error.message);
          Sentry.addBreadcrumb({
            category: 'email',
            message: 'Resend API returned error',
            level: 'error',
            data: { to, purpose, error: error.message, elapsed_ms: elapsed },
          });
          throw new Error(`Resend error: ${error.message}`);
        }

        Sentry.addBreadcrumb({
          category: 'email',
          message: `OTP email delivered (${purpose})`,
          level: 'info',
          data: { to, elapsed_ms: elapsed },
        });
        logger.info(logger.fmt`email.otp_sent purpose=${purpose} elapsed_ms=${elapsed}`);
        console.log(`[EmailService] OTP email sent to ${to} (${purpose}) in ${elapsed}ms`);
      },
    );
  }

  // ── Sign-up OTP ─────────────────────────────────────────────────────────

  async sendSignupOtp(data: { name: string; dob: string; email: string; password: string }): Promise<{ success: boolean; error?: string }> {
    const email = data.email.toLowerCase().trim();

    return Sentry.startSpan(
      {
        name: 'email.send-signup-otp',
        op: 'email.signup',
        attributes: { email },
      },
      async (span) => {
        Sentry.addBreadcrumb({
          category: 'email',
          message: 'sendSignupOtp initiated',
          level: 'info',
          data: { email },
        });

        const otp = this.generateOtp();

        this.pendingSignups.set(email, {
          ...data,
          email,
          otp,
          expiresAt: Date.now() + OTP_EXPIRY_MS,
          attempts: 0,
        });

        span.setAttribute('pending_signups', this.pendingSignups.size);

        try {
          await this.sendOtpEmail(email, otp, 'signup');
          span.setAttribute('success', true);
          Sentry.addBreadcrumb({
            category: 'email',
            message: 'Signup OTP sent successfully',
            level: 'info',
            data: { email },
          });
          logger.info(logger.fmt`email.signup_otp_sent email=${email}`);
          return { success: true };
        } catch (err: any) {
          span.setAttribute('success', false);
          Sentry.withScope((scope) => {
            scope.setTag('component', 'email-service');
            scope.setTag('op', 'sendSignupOtp');
            scope.setLevel('error');
            scope.setContext('otp_request', { email, purpose: 'signup' });
            Sentry.captureException(err);
          });
          console.error('[EmailService] Failed to send signup OTP:', err);
          this.pendingSignups.delete(email);
          return { success: false, error: 'Failed to send verification email. Please try again.' };
        }
      },
    );
  }

  verifySignupOtp(email: string, otp: string): { valid: boolean; data?: PendingSignup; error?: string } {
    return Sentry.startSpanManual(
      {
        name: 'email.verify-signup-otp',
        op: 'email.verify',
        attributes: { email },
      },
      (span, finish) => {
        Sentry.addBreadcrumb({
          category: 'email',
          message: 'verifySignupOtp attempt',
          level: 'info',
          data: { email },
        });

        const key = email.toLowerCase().trim();
        const pending = this.pendingSignups.get(key);

        if (!pending) {
          span.setAttribute('result', 'no_pending');
          Sentry.addBreadcrumb({ category: 'email', message: 'No pending signup for email', level: 'warning', data: { email } });
          finish();
          return { valid: false, error: 'No verification pending for this email. Please sign up again.' };
        }

        if (Date.now() > pending.expiresAt) {
          this.pendingSignups.delete(key);
          span.setAttribute('result', 'expired');
          Sentry.addBreadcrumb({ category: 'email', message: 'Signup OTP expired', level: 'warning', data: { email } });
          finish();
          return { valid: false, error: 'Code has expired. Please request a new one.' };
        }

        pending.attempts++;
        span.setAttribute('attempt', pending.attempts);

        if (pending.attempts > MAX_ATTEMPTS) {
          this.pendingSignups.delete(key);
          span.setAttribute('result', 'max_attempts');
          Sentry.captureMessage(`Signup OTP max attempts exceeded for ${email}`, 'warning');
          finish();
          return { valid: false, error: 'Too many failed attempts. Please request a new code.' };
        }

        if (pending.otp !== otp.trim()) {
          span.setAttribute('result', 'invalid_code');
          Sentry.addBreadcrumb({
            category: 'email',
            message: 'Invalid signup OTP entered',
            level: 'warning',
            data: { email, attempts: pending.attempts, remaining: MAX_ATTEMPTS - pending.attempts },
          });
          finish();
          return { valid: false, error: `Invalid code. ${MAX_ATTEMPTS - pending.attempts} attempts remaining.` };
        }

        this.pendingSignups.delete(key);
        span.setAttribute('result', 'success');
        Sentry.addBreadcrumb({ category: 'email', message: 'Signup OTP verified', level: 'info', data: { email } });
        logger.info(logger.fmt`email.signup_otp_verified email=${email}`);
        finish();
        return { valid: true, data: pending };
      },
    );
  }

  // ── Password Reset OTP ──────────────────────────────────────────────────

  async sendResetOtp(email: string): Promise<{ success: boolean; error?: string }> {
    const key = email.toLowerCase().trim();

    return Sentry.startSpan(
      {
        name: 'email.send-reset-otp',
        op: 'email.reset',
        attributes: { email: key },
      },
      async (span) => {
        Sentry.addBreadcrumb({
          category: 'email',
          message: 'sendResetOtp initiated',
          level: 'info',
          data: { email: key },
        });

        const otp = this.generateOtp();

        this.pendingResets.set(key, {
          otp,
          expiresAt: Date.now() + OTP_EXPIRY_MS,
          attempts: 0,
        });

        span.setAttribute('pending_resets', this.pendingResets.size);

        try {
          await this.sendOtpEmail(key, otp, 'reset');
          span.setAttribute('success', true);
          Sentry.addBreadcrumb({
            category: 'email',
            message: 'Reset OTP sent successfully',
            level: 'info',
            data: { email: key },
          });
          logger.info(logger.fmt`email.reset_otp_sent email=${key}`);
          return { success: true };
        } catch (err: any) {
          span.setAttribute('success', false);
          Sentry.withScope((scope) => {
            scope.setTag('component', 'email-service');
            scope.setTag('op', 'sendResetOtp');
            scope.setLevel('error');
            scope.setContext('otp_request', { email: key, purpose: 'reset' });
            Sentry.captureException(err);
          });
          console.error('[EmailService] Failed to send reset OTP:', err);
          this.pendingResets.delete(key);
          return { success: false, error: 'Failed to send reset email. Please try again.' };
        }
      },
    );
  }

  verifyResetOtp(email: string, otp: string): { valid: boolean; error?: string } {
    return Sentry.startSpanManual(
      {
        name: 'email.verify-reset-otp',
        op: 'email.verify',
        attributes: { email },
      },
      (span, finish) => {
        Sentry.addBreadcrumb({
          category: 'email',
          message: 'verifyResetOtp attempt',
          level: 'info',
          data: { email },
        });

        const key = email.toLowerCase().trim();
        const pending = this.pendingResets.get(key);

        if (!pending) {
          span.setAttribute('result', 'no_pending');
          Sentry.addBreadcrumb({ category: 'email', message: 'No pending reset for email', level: 'warning', data: { email } });
          finish();
          return { valid: false, error: 'No reset pending for this email. Please request a new code.' };
        }

        if (Date.now() > pending.expiresAt) {
          this.pendingResets.delete(key);
          span.setAttribute('result', 'expired');
          Sentry.addBreadcrumb({ category: 'email', message: 'Reset OTP expired', level: 'warning', data: { email } });
          finish();
          return { valid: false, error: 'Code has expired. Please request a new one.' };
        }

        pending.attempts++;
        span.setAttribute('attempt', pending.attempts);

        if (pending.attempts > MAX_ATTEMPTS) {
          this.pendingResets.delete(key);
          span.setAttribute('result', 'max_attempts');
          Sentry.captureMessage(`Reset OTP max attempts exceeded for ${email}`, 'warning');
          finish();
          return { valid: false, error: 'Too many failed attempts. Please request a new code.' };
        }

        if (pending.otp !== otp.trim()) {
          span.setAttribute('result', 'invalid_code');
          Sentry.addBreadcrumb({
            category: 'email',
            message: 'Invalid reset OTP entered',
            level: 'warning',
            data: { email, attempts: pending.attempts, remaining: MAX_ATTEMPTS - pending.attempts },
          });
          finish();
          return { valid: false, error: `Invalid code. ${MAX_ATTEMPTS - pending.attempts} attempts remaining.` };
        }

        this.pendingResets.delete(key);
        span.setAttribute('result', 'success');
        Sentry.addBreadcrumb({ category: 'email', message: 'Reset OTP verified', level: 'info', data: { email } });
        logger.info(logger.fmt`email.reset_otp_verified email=${email}`);
        finish();
        return { valid: true };
      },
    );
  }

  cleanup() {
    const now = Date.now();
    let expiredSignups = 0;
    let expiredResets = 0;

    for (const [key, val] of this.pendingSignups) {
      if (now > val.expiresAt) { this.pendingSignups.delete(key); expiredSignups++; }
    }
    for (const [key, val] of this.pendingResets) {
      if (now > val.expiresAt) { this.pendingResets.delete(key); expiredResets++; }
    }

    if (expiredSignups > 0 || expiredResets > 0) {
      Sentry.addBreadcrumb({
        category: 'email',
        message: 'OTP cleanup ran',
        level: 'info',
        data: { expiredSignups, expiredResets, remainingSignups: this.pendingSignups.size, remainingResets: this.pendingResets.size },
      });
    }
  }
}

export const emailService = new EmailService();

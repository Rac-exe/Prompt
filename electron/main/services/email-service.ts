import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/electron/main';

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
const OTP_LENGTH = 6;

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private pendingSignups = new Map<string, PendingSignup>();
  private pendingResets = new Map<string, PendingOtp>();
  private fromAddress: string = '';

  initialize() {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    this.fromAddress = process.env.SMTP_FROM || user || 'noreply@prmpt.app';

    if (!host || !user || !pass) {
      console.warn('[EmailService] SMTP not configured — OTP emails will be logged to console only');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      Sentry.addBreadcrumb({ category: 'email', message: 'SMTP transport created', level: 'info', data: { host } });
      console.log('[EmailService] SMTP transport created:', host);
    } catch (err: any) {
      Sentry.captureException(err, { tags: { component: 'email-service', op: 'initialize' } });
      console.error('[EmailService] Failed to create SMTP transport:', err);
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

    if (!this.transporter) {
      console.log(`[EmailService] (no SMTP) OTP for ${to}: ${otp}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.fromAddress,
      to,
      subject,
      html,
    });

    console.log(`[EmailService] OTP email sent to ${to} (${purpose})`);
  }

  // ── Sign-up OTP ─────────────────────────────────────────────────────────

  async sendSignupOtp(data: { name: string; dob: string; email: string; password: string }): Promise<{ success: boolean; error?: string }> {
    const email = data.email.toLowerCase().trim();
    const otp = this.generateOtp();

    this.pendingSignups.set(email, {
      ...data,
      email,
      otp,
      expiresAt: Date.now() + OTP_EXPIRY_MS,
      attempts: 0,
    });

    try {
      await this.sendOtpEmail(email, otp, 'signup');
      Sentry.addBreadcrumb({ category: 'email', message: 'Signup OTP sent', level: 'info', data: { email } });
      return { success: true };
    } catch (err: any) {
      Sentry.captureException(err, { tags: { component: 'email-service', op: 'sendSignupOtp' }, extra: { email } });
      console.error('[EmailService] Failed to send signup OTP:', err);
      this.pendingSignups.delete(email);
      return { success: false, error: 'Failed to send verification email. Please try again.' };
    }
  }

  verifySignupOtp(email: string, otp: string): { valid: boolean; data?: PendingSignup; error?: string } {
    const key = email.toLowerCase().trim();
    const pending = this.pendingSignups.get(key);

    if (!pending) {
      return { valid: false, error: 'No verification pending for this email. Please sign up again.' };
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingSignups.delete(key);
      return { valid: false, error: 'Code has expired. Please request a new one.' };
    }

    pending.attempts++;
    if (pending.attempts > MAX_ATTEMPTS) {
      this.pendingSignups.delete(key);
      return { valid: false, error: 'Too many failed attempts. Please request a new code.' };
    }

    if (pending.otp !== otp.trim()) {
      return { valid: false, error: `Invalid code. ${MAX_ATTEMPTS - pending.attempts} attempts remaining.` };
    }

    this.pendingSignups.delete(key);
    return { valid: true, data: pending };
  }

  // ── Password Reset OTP ──────────────────────────────────────────────────

  async sendResetOtp(email: string): Promise<{ success: boolean; error?: string }> {
    const key = email.toLowerCase().trim();
    const otp = this.generateOtp();

    this.pendingResets.set(key, {
      otp,
      expiresAt: Date.now() + OTP_EXPIRY_MS,
      attempts: 0,
    });

    try {
      await this.sendOtpEmail(key, otp, 'reset');
      Sentry.addBreadcrumb({ category: 'email', message: 'Reset OTP sent', level: 'info', data: { email: key } });
      return { success: true };
    } catch (err: any) {
      Sentry.captureException(err, { tags: { component: 'email-service', op: 'sendResetOtp' }, extra: { email: key } });
      console.error('[EmailService] Failed to send reset OTP:', err);
      this.pendingResets.delete(key);
      return { success: false, error: 'Failed to send reset email. Please try again.' };
    }
  }

  verifyResetOtp(email: string, otp: string): { valid: boolean; error?: string } {
    const key = email.toLowerCase().trim();
    const pending = this.pendingResets.get(key);

    if (!pending) {
      return { valid: false, error: 'No reset pending for this email. Please request a new code.' };
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingResets.delete(key);
      return { valid: false, error: 'Code has expired. Please request a new one.' };
    }

    pending.attempts++;
    if (pending.attempts > MAX_ATTEMPTS) {
      this.pendingResets.delete(key);
      return { valid: false, error: 'Too many failed attempts. Please request a new code.' };
    }

    if (pending.otp !== otp.trim()) {
      return { valid: false, error: `Invalid code. ${MAX_ATTEMPTS - pending.attempts} attempts remaining.` };
    }

    this.pendingResets.delete(key);
    return { valid: true };
  }

  cleanup() {
    const now = Date.now();
    for (const [key, val] of this.pendingSignups) {
      if (now > val.expiresAt) this.pendingSignups.delete(key);
    }
    for (const [key, val] of this.pendingResets) {
      if (now > val.expiresAt) this.pendingResets.delete(key);
    }
  }
}

export const emailService = new EmailService();

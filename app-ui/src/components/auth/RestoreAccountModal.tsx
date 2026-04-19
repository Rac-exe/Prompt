import { useState } from "react";
import * as Sentry from '@sentry/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, CircleNotch, ShieldCheck } from "@phosphor-icons/react";
import { OtpVerification } from "@/components/auth/OtpVerification";
import { toast } from "@/hooks/use-toast";

interface RestoreAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the email field (e.g. from a "User is banned" sign-in attempt). */
  initialEmail?: string;
  /** Called after a successful restore — caller should reset the login form. */
  onRestored?: (email: string) => void;
}

type Step = 'email' | 'otp';

/**
 * Two-step account restoration:
 *   1. User enters the email of the account that's pending deletion.
 *      → POST /account/request-restore (Python) → emails a 6-digit OTP.
 *   2. User enters the OTP.
 *      → POST /account/confirm-restore (Python) → verifies OTP → calls the
 *        SECURITY DEFINER `restore_account` RPC which clears the deletion
 *        request and lifts the auth ban. The user can now sign in normally.
 */
export function RestoreAccountModal({
  open,
  onOpenChange,
  initialEmail,
  onRestored,
}: RestoreAccountModalProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | undefined>();

  const reset = () => {
    setStep('email');
    setEmail(initialEmail ?? '');
    setSending(false);
    setVerifying(false);
    setOtpError(undefined);
  };

  const handleClose = (next: boolean) => {
    if (sending || verifying) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);
    setOtpError(undefined);
    Sentry.addBreadcrumb({ category: 'auth', message: 'Restore OTP requested', level: 'info' });
    try {
      const result = await window.electronAPI?.deletion?.restore?.request(trimmed);
      if (result?.success) {
        toast({ title: 'Code sent', description: 'Check your inbox for the restore code.' });
        setStep('otp');
      } else {
        toast({ variant: 'destructive', title: 'Failed', description: result?.error ?? 'Could not send code.' });
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'restore-account-modal', op: 'request' } });
      toast({ variant: 'destructive', title: 'Error', description: 'Could not send restore code.' });
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async (otp: string) => {
    if (verifying) return;
    setVerifying(true);
    setOtpError(undefined);
    Sentry.addBreadcrumb({ category: 'auth', message: 'Restore OTP submitted', level: 'info' });
    try {
      const trimmed = email.trim();
      const result = await window.electronAPI?.deletion?.restore?.confirm(trimmed, otp);
      if (result?.success) {
        toast({
          title: 'Account restored',
          description: 'Welcome back! You can now sign in normally.',
          duration: 6000,
        });
        onOpenChange(false);
        onRestored?.(trimmed);
        reset();
      } else {
        const msg = result?.error ?? 'Invalid code. Please try again.';
        setOtpError(msg);
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'restore-account-modal', op: 'confirm' } });
      setOtpError('Restore failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setOtpError(undefined);
    try {
      const result = await window.electronAPI?.deletion?.restore?.request(email.trim());
      if (result?.success) {
        toast({ title: 'Code resent', description: 'A new restore code is on the way.' });
      } else {
        setOtpError(result?.error ?? 'Could not resend code.');
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'restore-account-modal', op: 'resend' } });
      setOtpError('Could not resend code.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[440px] bg-background border-border rounded-2xl p-0 gap-0 overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-emerald/10 flex items-center justify-center flex-shrink-0">
                <ShieldCheck size={18} weight="fill" className="text-emerald" />
              </div>
              <DialogTitle className="text-lg font-bold text-foreground tracking-tight">Restore your account</DialogTitle>
            </div>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              {step === 'email'
                ? "Enter the email of the account you want to restore. We'll send you a 6-digit code."
                : "We sent a 6-digit code to your inbox. Enter it below to cancel the scheduled deletion."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-5">
          {step === 'email' ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="restore-email" className="text-sm font-medium text-foreground">
                  Email address
                </Label>
                <Input
                  id="restore-email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={sending}
                  className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => handleClose(false)}
                  disabled={sending}
                  className="h-9 text-sm border-border"
                >
                  Cancel
                </Button>
                <Button
                  type="submit" size="sm"
                  disabled={sending || !email.trim()}
                  className="h-9 text-sm min-w-[120px] border border-input text-foreground hover:bg-muted"
                >
                  {sending ? (
                    <CircleNotch size={14} weight="light" className="animate-spin" />
                  ) : (
                    <span className="flex items-center gap-1.5">
                      Send code <ArrowRight size={14} weight="light" />
                    </span>
                  )}
                </Button>
              </div>
            </form>
          ) : (
            <OtpVerification
              email={email}
              purpose="reset"
              isLoading={verifying}
              error={otpError}
              onVerify={handleVerify}
              onResend={handleResend}
              onBack={() => { setStep('email'); setOtpError(undefined); }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

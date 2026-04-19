import { useState, useEffect, useRef } from "react";
import * as Sentry from '@sentry/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { CircleNotch, ShieldCheck } from "@phosphor-icons/react";
import { OtpVerification } from "@/components/auth/OtpVerification";
import { toast } from "@/hooks/use-toast";

interface RestoreAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Email of the locked-out account — taken from the failed sign-in attempt. */
  email: string;
  /** Called after a successful restore — caller should reset the login form. */
  onRestored?: (email: string) => void;
}

/**
 * One-step account restoration, opened from the locked-account banner on the
 * login screen:
 *   1. The login email is already known. We auto-send a restore OTP to it.
 *   2. User enters the OTP.
 *      → POST /account/confirm-restore (Python) → verifies OTP → calls the
 *        SECURITY DEFINER `restore_account` RPC which clears the deletion
 *        request and lifts the auth ban. The user can now sign in normally.
 *
 * Cancel from the modal returns the user to the sign-in form unchanged.
 */
export function RestoreAccountModal({
  open,
  onOpenChange,
  email,
  onRestored,
}: RestoreAccountModalProps) {
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>();
  const [otpError, setOtpError] = useState<string | undefined>();
  // Tracks whether we've fired the initial send for this open() lifecycle so
  // a re-render or React-Strict double-mount can't double-fire the OTP email.
  const sentForRef = useRef<string | null>(null);

  const trimmed = email.trim();

  const sendOtp = async (mode: 'initial' | 'resend') => {
    if (!trimmed) return;
    setSending(true);
    setSendError(undefined);
    setOtpError(undefined);
    Sentry.addBreadcrumb({
      category: 'auth',
      message: `Restore OTP ${mode}`,
      level: 'info',
      data: { email: trimmed },
    });
    try {
      const result = await window.electronAPI?.deletion?.restore?.request(trimmed);
      if (result?.success) {
        if (mode === 'resend') {
          toast({ title: 'Code resent', description: 'A new restore code is on the way.' });
        }
      } else {
        const msg = result?.error ?? 'Could not send restore code.';
        setSendError(msg);
        if (mode === 'resend') {
          toast({ variant: 'destructive', title: 'Failed to resend', description: msg });
        }
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'restore-account-modal', op: mode } });
      setSendError('Could not send restore code. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // Auto-send the OTP exactly once per (open, email) pair.
  useEffect(() => {
    if (!open || !trimmed) return;
    if (sentForRef.current === trimmed) return;
    sentForRef.current = trimmed;
    void sendOtp('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trimmed]);

  const handleClose = (next: boolean) => {
    if (sending || verifying) return;
    if (!next) {
      sentForRef.current = null;
      setSendError(undefined);
      setOtpError(undefined);
    }
    onOpenChange(next);
  };

  const handleVerify = async (otp: string) => {
    if (verifying) return;
    setVerifying(true);
    setOtpError(undefined);
    Sentry.addBreadcrumb({ category: 'auth', message: 'Restore OTP submitted', level: 'info' });
    try {
      const result = await window.electronAPI?.deletion?.restore?.confirm(trimmed, otp);
      if (result?.success) {
        toast({
          title: 'Account restored',
          description: 'Welcome back! You can now sign in normally.',
          duration: 6000,
        });
        sentForRef.current = null;
        onOpenChange(false);
        onRestored?.(trimmed);
      } else {
        setOtpError(result?.error ?? 'Invalid code. Please try again.');
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'restore-account-modal', op: 'confirm' } });
      setOtpError('Restore failed. Please try again.');
    } finally {
      setVerifying(false);
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
              We sent a 6-digit code to <span className="font-mono text-foreground">{trimmed}</span>. Enter it below to cancel the scheduled deletion and unlock sign-in.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-5">
          {sending && !sentForRef.current ? null : null}
          {sendError ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3.5 text-sm text-destructive">
                {sendError}
              </div>
              <button
                type="button"
                onClick={() => sendOtp('resend')}
                disabled={sending}
                className="text-xs text-emerald hover:text-emerald/80 font-medium transition-colors disabled:opacity-50"
              >
                {sending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CircleNotch size={12} weight="light" className="animate-spin" /> Retrying…
                  </span>
                ) : (
                  'Try again'
                )}
              </button>
            </div>
          ) : (
            <OtpVerification
              email={trimmed}
              purpose="reset"
              isLoading={verifying || sending}
              error={otpError}
              onVerify={handleVerify}
              onResend={() => sendOtp('resend')}
              onBack={() => handleClose(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import * as Sentry from '@sentry/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CircleNotch, Warning } from "@phosphor-icons/react";
import { toast } from "@/hooks/use-toast";

interface DeleteAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The currently signed-in user's email — used as the type-to-confirm value. */
  userEmail: string;
  /** Optional callback invoked AFTER the deletion request succeeds and the user
   *  has been signed out. Useful for routing back to the login screen. */
  onDeletionRequested?: () => void;
}

/**
 * Hard-lockout deletion confirmation:
 *   • User must type their exact email address to enable submission.
 *   • An optional reason can be left for product feedback.
 *   • On success the main process force-signs-out automatically and broadcasts
 *     `auth:state-changed`. Any listening view will route to the login screen.
 *   • The user CANNOT sign in again for 30 days unless they restore the account
 *     via the "Restore deleted account" link on the login screen.
 */
export function DeleteAccountModal({
  open,
  onOpenChange,
  userEmail,
  onDeletionRequested,
}: DeleteAccountModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const normalizedEmail = (userEmail || "").trim().toLowerCase();
  const isMatch = confirmText.trim().toLowerCase() === normalizedEmail && normalizedEmail.length > 0;

  const handleClose = (next: boolean) => {
    if (submitting) return;
    if (!next) {
      setConfirmText("");
      setReason("");
    }
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (!isMatch || submitting) return;
    setSubmitting(true);
    Sentry.addBreadcrumb({ category: 'gdpr', message: 'Account deletion confirmed in modal', level: 'warning' });

    try {
      const result = await window.electronAPI?.deletion?.request(reason.trim() || undefined);
      if (result?.success) {
        toast({
          title: "Account deletion scheduled",
          description: result.message ?? "You've been signed out. The account will be permanently deleted in 30 days.",
          duration: 8000,
        });
        // Clear form before parent unmounts.
        setConfirmText("");
        setReason("");
        onOpenChange(false);
        onDeletionRequested?.();
      } else {
        toast({
          variant: "destructive",
          title: "Couldn't schedule deletion",
          description: result?.error ?? "Something went wrong. Please try again.",
          duration: 6000,
        });
        Sentry.addBreadcrumb({ category: 'gdpr', message: 'Deletion request failed', level: 'error', data: { error: result?.error } });
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'delete-account-modal' } });
      toast({
        variant: "destructive",
        title: "Couldn't schedule deletion",
        description: "Something went wrong. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px] bg-background border-border rounded-2xl p-0 gap-0 overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border bg-destructive/4">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-destructive/15 flex items-center justify-center flex-shrink-0">
                <Warning size={18} weight="fill" className="text-destructive" />
              </div>
              <DialogTitle className="text-lg font-bold text-foreground tracking-tight">Delete account</DialogTitle>
            </div>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              This will permanently delete your account, all chats, prompts, attachments, and avatar after a 30-day grace period. You'll be signed out immediately and won't be able to sign back in.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3.5 text-xs text-foreground/80 leading-relaxed">
            <p className="font-medium text-destructive mb-1">What happens next</p>
            <ul className="space-y-1 list-disc list-inside marker:text-destructive/70">
              <li>You're signed out from every device.</li>
              <li>Sign-in is blocked across email, Google, and GitHub for 30 days.</li>
              <li>On day 30 your data is wiped — chats, prompts, files, avatar.</li>
              <li>You can cancel this within 30 days via "Restore deleted account" on the sign-in screen (an emailed code is required).</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-email" className="text-sm font-medium text-foreground">
              Type your email to confirm
            </Label>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono text-foreground/80">{normalizedEmail || '—'}</span>
            </p>
            <Input
              id="confirm-email"
              autoComplete="off"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="you@example.com"
              disabled={submitting}
              className="h-10 bg-surface border-border focus-visible:border-destructive/60 focus-visible:ring-destructive/20"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason" className="text-sm font-medium text-foreground">
              Reason <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Help us improve — what made you leave?"
              disabled={submitting}
              rows={3}
              maxLength={500}
              className="bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-sm resize-none"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-end gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleClose(false)}
            disabled={submitting}
            className="h-9 text-sm border-border"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleConfirm}
            disabled={!isMatch || submitting}
            className="h-9 text-sm min-w-[140px]"
          >
            {submitting ? (
              <CircleNotch size={14} weight="light" className="animate-spin" />
            ) : (
              "Delete my account"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

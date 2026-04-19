import { useState, useEffect, useRef } from 'react';
import * as Sentry from '@sentry/react';
import { Logo } from "@/components/ui/Logo";
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lightning, ArrowRight, ArrowLeft, CircleNotch, Minus, Square, X, GithubLogo, Key, ShieldCheck } from '@phosphor-icons/react';
import { OtpVerification } from './OtpVerification';
import { RestoreAccountModal } from './RestoreAccountModal';
import { motion } from 'motion/react';

/* ─────────────────────────────────────────────────────────────
   Rocket drop animation for the left panel hero
   ───────────────────────────────────────────────────────────── */
type HeroPhase = 'idle' | 'rocket-in' | 'logo-drop' | 'rocket-out' | 'text-in' | 'hold' | 'fade-out';

function LoginHeroAnimation() {
  const [phase, setPhase] = useState<HeroPhase>('idle');

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const add = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
    switch (phase) {
      case 'idle':       add(() => setPhase('rocket-in'),   500);  break;
      case 'rocket-in':  add(() => setPhase('logo-drop'),  1650);  break;
      case 'logo-drop':  add(() => setPhase('rocket-out'),  350); break;
      case 'rocket-out': add(() => setPhase('text-in'),     450); break;
      case 'text-in':    add(() => setPhase('hold'),       1400); break;
      case 'hold':       add(() => setPhase('fade-out'),   5500); break;
      case 'fade-out':   add(() => setPhase('idle'),        600); break;
    }
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  const rocketGone  = ['rocket-out', 'text-in', 'hold', 'fade-out'].includes(phase);
  const logoVisible = !['idle', 'rocket-in'].includes(phase);
  const textVisible = ['text-in', 'hold'].includes(phase);
  const fadingOut   = phase === 'fade-out';

  return (
    <div className="relative z-10 flex flex-col items-center justify-center flex-1 text-center">
      {/* Rocket + Logo — stacked at the same anchor point */}
      <div className="relative flex items-center justify-center mb-6" style={{ width: 96, height: 96 }}>
        {/* Rocket 🚀 */}
        <motion.div
          initial={{ x: 165, y: -170, opacity: 0, rotate: -80, scale: 1 }}
          animate={
            phase === 'idle'
              ? { x: 165, y: -170, opacity: 0, rotate: -80, scale: 1 }
              : phase === 'rocket-in'
                ? {
                    // Hook path: top-right → sweep left across top → down left side → curve back to center
                    x:       [165,  -60, -160,  -50,   0],
                    y:       [-170, -150,   15,   80,   0],
                    opacity: [0,      1,    1,    1,    1],
                    rotate:  [-80,  -65,   20,   30,   0],
                    scale: 1,
                  }
                : rocketGone
                  ? { x: 220, y: -150, opacity: 0, rotate: -30, scale: 0.55 }
                  : phase === 'logo-drop'
                    ? { x: 0, y: 8, opacity: 1, rotate: 6, scale: 0.92 }
                    : { x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }
          }
          transition={
            phase === 'rocket-in'
              ? { duration: 1.55, ease: [0.4, 0, 0.2, 1], times: [0, 0.18, 0.52, 0.76, 1] }
              : rocketGone
                ? { type: 'spring', damping: 12, stiffness: 160, mass: 0.7 }
                : { type: 'spring', damping: 16, stiffness: 130 }
          }
          style={{ position: 'absolute', fontSize: 56, lineHeight: 1, filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.15))' }}
        >
          🚀
        </motion.div>

        {/* Logo — appears where the rocket rested */}
        <motion.div
          animate={
            fadingOut
              ? { scale: 0.82, opacity: 0 }
              : logoVisible
                ? { scale: 1, opacity: 1 }
                : { scale: 0, opacity: 0 }
          }
          transition={
            logoVisible && !fadingOut
              ? { type: 'spring', damping: 9, stiffness: 220, delay: 0.05 }
              : { duration: 0.32 }
          }
          style={{ position: 'absolute' }}
        >
          <Logo size="w-20 h-20" />
        </motion.div>
      </div>

      {/* Badge */}
      <motion.div
        animate={fadingOut ? { opacity: 0, y: -4 } : textVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
        transition={{ duration: 0.42, delay: textVisible ? 0 : 0 }}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-muted text-emerald text-xs font-semibold tracking-wide mb-4"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald animate-pulse-subtle" />
        Optimization Studio
      </motion.div>

      {/* Title */}
      <motion.h1
        animate={fadingOut ? { opacity: 0, y: -4 } : textVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
        transition={{ duration: 0.42, delay: textVisible ? 0.14 : 0 }}
        className="text-3xl font-bold text-foreground leading-tight mb-3"
      >
        Transform your prompts.<br />
        <span className="text-gradient-primary">Amplify your results.</span>
      </motion.h1>

      {/* Description */}
      <motion.p
        animate={fadingOut ? { opacity: 0, y: -4 } : textVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
        transition={{ duration: 0.42, delay: textVisible ? 0.28 : 0 }}
        className="text-muted-foreground text-sm leading-relaxed max-w-xs mb-5"
      >
        Precision-engineered AI prompts that deliver clearer, faster, and more consistent outputs every time.
      </motion.p>

      {/* Feature pills */}
      <motion.div
        animate={fadingOut ? { opacity: 0, y: -4 } : textVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ duration: 0.42, delay: textVisible ? 0.42 : 0 }}
        className="flex flex-wrap gap-2 justify-center"
      >
        {['AI-Powered Optimization', 'Prompt Library', 'Voice Input', 'Team Sharing'].map((f) => (
          <span key={f} className="px-3 py-1 rounded-full bg-sidebar-accent text-sidebar-foreground text-xs font-medium border border-sidebar-border">{f}</span>
        ))}
      </motion.div>
    </div>
  );
}

interface LoginPageProps {
  onSwitchToSignup: () => void;
  onLoginSuccess: () => void;
  error?: string | null;
}

type LoginView = 'login' | 'reset-otp' | 'reset-password';

export function LoginPage({ onSwitchToSignup, onLoginSuccess, error: externalError }: LoginPageProps) {
  const [view, setView] = useState<LoginView>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [otpError, setOtpError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetPasswordError, setResetPasswordError] = useState('');
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const resetOtpRef = useRef<string | null>(null);
  const [bannedEmail, setBannedEmail] = useState<string | null>(null);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const { toast } = useToast();

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast({ variant: 'destructive', title: 'Enter your email first' });
      return;
    }
    setResetLoading(true);
    Sentry.addBreadcrumb({ category: 'auth', message: 'Password reset OTP requested', level: 'info' });
    try {
      const result = await window.electronAPI?.sendResetOtp(trimmedEmail);
      if (result?.error) {
        toast({ variant: 'destructive', title: "Couldn't send reset code", description: result.error });
      } else {
        setResetEmail(trimmedEmail);
        setView('reset-otp');
        setOtpError('');
        toast({ title: 'Code sent', description: `We sent a 6-digit code to ${trimmedEmail}.` });
      }
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'login-page', op: 'auth:send-reset-otp' } });
      toast({ variant: 'destructive', title: "Couldn't send reset code", description: 'Something went wrong. Please try again.' });
    } finally {
      setResetLoading(false);
    }
  };

  const handleVerifyResetOtp = async (otp: string) => {
    setOtpError('');
    setView('reset-password');
    setNewPassword('');
    setConfirmNewPassword('');
    setResetPasswordError('');
    resetOtpRef.current = otp;
    Sentry.addBreadcrumb({ category: 'auth', message: 'Reset OTP verified — entering new password', level: 'info' });
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetPasswordError('');

    if (newPassword.length < 6) {
      setResetPasswordError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setResetPasswordError('Passwords do not match');
      return;
    }

    setResetPasswordLoading(true);
    Sentry.addBreadcrumb({ category: 'auth', message: 'Password reset submitted', level: 'info' });
    try {
      const otp = resetOtpRef.current;
      const result = await window.electronAPI?.verifyResetOtp(resetEmail, otp, newPassword);
      if (result?.error) {
        setResetPasswordError(result.error);
        if (result.error.toLowerCase().includes('code') || result.error.toLowerCase().includes('expired')) {
          setView('reset-otp');
          setOtpError(result.error);
        }
      } else {
        resetOtpRef.current = null;
        Sentry.addBreadcrumb({ category: 'auth', message: 'Password reset successful', level: 'info' });
        toast({ title: 'Password updated', description: 'You can now sign in with your new password.' });
        setView('login');
        setPassword('');
        setEmail(resetEmail);
      }
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'login-page', op: 'auth:verify-reset-otp' } });
      setResetPasswordError('Failed to update password. Please try again.');
    } finally {
      setResetPasswordLoading(false);
    }
  };

  const handleResendResetOtp = async () => {
    Sentry.addBreadcrumb({ category: 'auth', message: 'Reset OTP resend requested', level: 'info' });
    try {
      const result = await window.electronAPI?.sendResetOtp(resetEmail);
      if (result?.error) {
        setOtpError(result.error);
      } else {
        toast({ title: 'Code resent', description: 'A new code is on the way.' });
      }
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'login-page', op: 'auth:resend-reset-otp' } });
      setOtpError('Failed to resend code.');
    }
  };

  useEffect(() => {
    if (externalError) {
      setIsLoading(false);
    }
  }, [externalError]);

  const handleOAuth = async (provider: 'google' | 'github') => {
    if (oauthLoading || isLoading) return;
    setOauthLoading(provider);
    Sentry.addBreadcrumb({ category: 'auth', message: `OAuth sign-in started: ${provider}`, level: 'info' });
    try {
      if (!window.electronAPI?.signInWithOAuth) {
        toast({ variant: 'destructive', title: 'This feature needs the desktop app', description: 'Open Prmpt on your computer to continue.' });
        return;
      }
      const result = await window.electronAPI.signInWithOAuth(provider);
      if (result?.error) {
        toast({ variant: 'destructive', title: "Couldn't sign you in", description: result.error, duration: 4000 });
      }
      // On success, the browser opens. Auth state will update via deep-link callback.
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'login-page', op: `auth:oauth-${provider}` } });
      toast({ variant: 'destructive', title: "Couldn't sign you in", description: 'Something went wrong. Please try again.' });
    } finally {
      setOauthLoading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setBannedEmail(null);
    Sentry.addBreadcrumb({ category: 'auth', message: 'Password sign-in attempted', level: 'info' });
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.signIn({ email, password });
        if (result?.error) {
          const lowerError = result.error.toLowerCase();
          const isInvalidCreds = lowerError.includes('invalid login credentials');
          const isBanned = lowerError.includes('user is banned') || lowerError.includes('banned');
          if (isBanned) {
            setBannedEmail(email.trim());
            setPassword('');
            // No toast — the inline panel below the form is the affordance.
          } else {
            toast({
              variant: "destructive",
              title: isInvalidCreds ? "Wrong email or password" : "Couldn't sign you in",
              description: isInvalidCreds
                ? 'If you signed up with Google or GitHub, use that instead — or reset your password.'
                : result.error,
              duration: 5000,
            });
            setPassword('');
          }
        }
      } else {
        toast({
          variant: "destructive",
          title: "This feature needs the desktop app",
          description: 'Open Prmpt on your computer to continue.',
        });
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'login-page', op: 'auth:sign-in' } });
      toast({
        variant: "destructive",
        title: "Couldn't sign you in",
        description: 'Something went wrong. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const isMac = (window.electronAPI as any)?.platform === 'darwin';
  const windowTitleBar = (
    <div
      className="h-9 flex-shrink-0 flex items-center justify-end select-none bg-background"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {!isMac && (
        <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => (window.electronAPI as any)?.windowControls?.minimize()} aria-label="Minimise" className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"><Minus size={14} weight="light" /></button>
          <button onClick={() => (window.electronAPI as any)?.windowControls?.maximize()} aria-label="Maximise" className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"><Square size={12} weight="light" /></button>
          <button onClick={() => (window.electronAPI as any)?.windowControls?.close()} aria-label="Close" className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-white hover:bg-red-500/80 transition-colors duration-150"><X size={14} weight="light" /></button>
        </div>
      )}
    </div>
  );

  if (view === 'reset-otp') {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        {windowTitleBar}
        <div className="flex-1 flex items-center justify-center p-8">
          <OtpVerification
            email={resetEmail}
            purpose="reset"
            isLoading={false}
            error={otpError}
            onVerify={handleVerifyResetOtp}
            onResend={handleResendResetOtp}
            onBack={() => { setView('login'); setOtpError(''); }}
          />
        </div>
      </div>
    );
  }

  if (view === 'reset-password') {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        {windowTitleBar}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-[380px] space-y-7 animate-fade-in">
            <button
              onClick={() => { setView('reset-otp'); setResetPasswordError(''); }}
              disabled={resetPasswordLoading}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <ArrowLeft size={16} weight="light" />
              Back
            </button>

            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald/10 flex items-center justify-center">
                <Key size={28} weight="light" className="text-emerald" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold text-foreground tracking-tight">Set new password</h2>
                <p className="text-sm text-muted-foreground">Choose a strong password for your account</p>
              </div>
            </div>

            {resetPasswordError && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-destructive/8 border border-destructive/20 animate-slide-up">
                <div className="w-4 h-4 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                </div>
                <p className="text-sm text-destructive leading-snug">{resetPasswordError}</p>
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="newPassword" className="text-sm font-medium text-foreground">New password</Label>
                <Input
                  id="newPassword" type="password" placeholder="••••••••"
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  required minLength={6} disabled={resetPasswordLoading}
                  className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground placeholder:text-muted-foreground/60 transition-button"
                />
                <p className="text-xs text-muted-foreground">Minimum 6 characters</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmNewPassword" className="text-sm font-medium text-foreground">Confirm new password</Label>
                <Input
                  id="confirmNewPassword" type="password" placeholder="••••••••"
                  value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required minLength={6} disabled={resetPasswordLoading}
                  className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground placeholder:text-muted-foreground/60 transition-button"
                />
              </div>

              <Button
                type="submit" disabled={resetPasswordLoading}
                className="w-full h-10 border border-input text-foreground hover:bg-muted font-semibold transition-button mt-1"
              >
                {resetPasswordLoading ? (
                  <CircleNotch size={16} weight="light" className="animate-spin" />
                ) : (
                  <span className="flex items-center gap-2">
                    Update Password
                    <ArrowRight size={16} weight="light" />
                  </span>
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Window title bar ── */}
      {windowTitleBar}
      <div className="flex flex-1">
      {/* Left decorative panel */}
      <div className="hidden lg:flex lg:w-[42%] bg-sidebar flex-col justify-between p-12 border-r border-sidebar-border relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
                              linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
          }}
        />
        {/* Emerald glow blob */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-emerald/6 blur-3xl pointer-events-none" />

        {/* Brand */}
        <div className="relative z-10 flex items-center gap-3">
          <Logo size="w-9 h-9" />
          <span className="font-bold text-foreground text-lg tracking-tight">Prmpt</span>
        </div>

        {/* Hero animation */}
        <LoginHeroAnimation />

        {/* Footer quote */}
        <p className="relative z-10 text-xs text-muted-foreground/50 italic">
          "The quality of your output begins with the quality of your input."
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[380px] space-y-8 animate-fade-in">
          {/* Mobile brand */}
          <div className="flex items-center gap-3 lg:hidden">
            <Logo size="w-8 h-8" />
            <span className="font-bold text-foreground">Prmpt</span>
          </div>

          {/* Heading */}
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground">Sign in to continue to your workspace</p>
          </div>

          {/* OAuth buttons */}
          <div className="space-y-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOAuth('google')}
              disabled={isLoading || !!oauthLoading}
              className="w-full h-10 border-border text-foreground hover:bg-secondary font-medium transition-button flex items-center gap-2.5"
            >
              {oauthLoading === 'google' ? (
                <CircleNotch size={16} weight="light" className="animate-spin" />
              ) : (
                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              Continue with Google
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => handleOAuth('github')}
              disabled={isLoading || !!oauthLoading}
              className="w-full h-10 border-border text-foreground hover:bg-secondary font-medium transition-button flex items-center gap-2.5"
            >
              {oauthLoading === 'github' ? (
                <CircleNotch size={16} weight="light" className="animate-spin" />
              ) : (
                <GithubLogo size={16} weight="light" className="flex-shrink-0" />
              )}
              Continue with GitHub
            </Button>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-3 text-muted-foreground">Or sign in with email</span>
            </div>
          </div>

          {/* Banned-account inline panel */}
          {bannedEmail && (
            <div className="flex items-start gap-3 p-3.5 rounded-lg bg-amber-500/8 border border-amber-500/25 animate-slide-up">
              <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ShieldCheck size={16} weight="fill" className="text-amber-500" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Account scheduled for deletion</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    This account is locked because deletion was requested. You can cancel the deletion within the 30-day grace period.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setRestoreModalOpen(true)}
                  className="h-8 text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                >
                  Restore now
                </Button>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-foreground">
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={isLoading}
                className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground placeholder:text-muted-foreground/60 transition-button"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </Label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetLoading}
                  className="text-xs text-emerald hover:text-emerald/80 font-medium transition-colors disabled:opacity-50"
                >
                  {resetLoading ? 'Sending...' : 'Forgot password?'}
                </button>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={isLoading}
                minLength={6}
                className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground placeholder:text-muted-foreground/60 transition-button"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-10 border border-input text-foreground hover:bg-muted font-semibold transition-button"
            >
              {isLoading ? (
                <CircleNotch size={16} weight="light" className="animate-spin" />
              ) : (
                <span className="flex items-center gap-2">
                  Sign In
                  <ArrowRight size={16} weight="light" />
                </span>
              )}
            </Button>
          </form>

          {/* Switch to sign up */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-3 text-muted-foreground">Don't have an account?</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={onSwitchToSignup}
            disabled={isLoading || !!oauthLoading}
            className="w-full h-10 border-border text-foreground hover:bg-secondary hover:border-border font-medium transition-button"
          >
            Create an account
          </Button>
        </div>
      </div>
      </div>

      <RestoreAccountModal
        open={restoreModalOpen}
        onOpenChange={setRestoreModalOpen}
        email={bannedEmail ?? ''}
        onRestored={(restoredEmail) => {
          setBannedEmail(null);
          setEmail(restoredEmail);
          setPassword('');
        }}
      />
    </div>
  );
}

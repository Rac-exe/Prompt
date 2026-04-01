import { useState, useEffect } from 'react';
import { Logo } from "@/components/ui/Logo";
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lightning, ArrowRight, CircleNotch, Minus, Square, X, GithubLogo } from '@phosphor-icons/react';

interface LoginPageProps {
  onSwitchToSignup: () => void;
  onLoginSuccess: () => void;
  error?: string | null;
}

export function LoginPage({ onSwitchToSignup, onLoginSuccess, error: externalError }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const { toast } = useToast();

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      toast({ variant: 'destructive', title: 'Enter your email', description: 'Type your email address above first.' });
      return;
    }
    setResetLoading(true);
    try {
      const result = await window.electronAPI?.resetPassword(email.trim());
      if (result?.error) {
        toast({ variant: 'destructive', title: 'Failed', description: result.error });
      } else {
        toast({ title: 'Email sent', description: 'Check your inbox for a password reset link.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not send reset email.' });
    } finally {
      setResetLoading(false);
    }
  };

  useEffect(() => {
    if (externalError) {
      setIsLoading(false);
      setPassword('');
      setEmail('');

      const isInvalidCreds = externalError.toLowerCase().includes('invalid login credentials');
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: isInvalidCreds
          ? 'Wrong password, or you may have signed up with Google/GitHub. Try those or reset your password.'
          : externalError,
        duration: 5000,
      });
    }
  }, [externalError, toast]);

  const handleOAuth = async (provider: 'google' | 'github') => {
    if (oauthLoading || isLoading) return;
    setOauthLoading(provider);
    try {
      if (!window.electronAPI?.signInWithOAuth) {
        toast({ variant: 'destructive', title: 'System Error', description: 'This app requires Electron to run' });
        return;
      }
      const result = await window.electronAPI.signInWithOAuth(provider);
      if (result?.error) {
        toast({ variant: 'destructive', title: 'Sign-in Failed', description: result.error, duration: 4000 });
      }
      // On success, the browser opens. Auth state will update via deep-link callback.
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'An unexpected error occurred' });
    } finally {
      setOauthLoading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    try {
      if (window.electronAPI) {
        window.electronAPI.signIn({ email, password });
      } else {
        toast({
          variant: "destructive",
          title: "System Error",
          description: 'This app requires Electron to run',
        });
        setIsLoading(false);
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error",
        description: 'An unexpected error occurred',
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Window title bar ── */}
      <div
        className="h-9 flex-shrink-0 flex items-center justify-end select-none bg-background"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => window.electronAPI?.windowControls?.minimize()} aria-label="Minimise" className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"><Minus size={14} weight="light" /></button>
          <button onClick={() => window.electronAPI?.windowControls?.maximize()} aria-label="Maximise" className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"><Square size={12} weight="light" /></button>
          <button onClick={() => window.electronAPI?.windowControls?.close()} aria-label="Close" className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-white hover:bg-red-500/80 transition-colors duration-150"><X size={14} weight="light" /></button>
        </div>
      </div>
      <div className="flex flex-1">
      {/* Left decorative panel */}
      <div className="hidden lg:flex lg:w-[42%] bg-sidebar flex-col justify-between p-12 border-r border-sidebar-border relative overflow-hidden">
        {/* Subtle grid pattern */}
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

        {/* Hero content */}
        <div className="relative z-10 space-y-6">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-muted text-emerald text-xs font-semibold tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald animate-pulse-subtle" />
              Optimization Studio
            </div>
            <h1 className="text-3xl font-bold text-foreground leading-tight">
              Transform your prompts.<br />
              <span className="text-gradient-primary">Amplify your results.</span>
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
              Precision-engineered AI prompts that deliver clearer, faster, and more consistent outputs every time.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {['AI-Powered Optimization', 'Prompt Library', 'Voice Input', 'Team Sharing'].map((f) => (
              <span
                key={f}
                className="px-3 py-1 rounded-full bg-sidebar-accent text-sidebar-foreground text-xs font-medium border border-sidebar-border"
              >
                {f}
              </span>
            ))}
          </div>
        </div>

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
              className="w-full h-10 bg-emerald hover:bg-emerald/90 text-white font-semibold glow-emerald-sm transition-button"
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
    </div>
  );
}

import { useState } from 'react';
import { Logo } from "@/components/ui/Logo";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from "@/components/ui/use-toast";
import { Zap, ArrowRight, Loader2, Minus, Square, X, Github } from 'lucide-react';

interface SignupPageProps {
  onSwitchToLogin: () => void;
  onSignupSuccess: () => void;
}

export function SignupPage({ onSwitchToLogin, onSignupSuccess }: SignupPageProps) {
  const [formData, setFormData] = useState({
    name: '',
    dob: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    if (oauthLoading || isLoading) return;
    setOauthLoading(provider);
    try {
      if (!window.electronAPI?.signInWithOAuth) {
        setError('This app requires Electron to run');
        return;
      }
      const result = await window.electronAPI.signInWithOAuth(provider);
      if (result?.error) {
        toast({ variant: 'destructive', title: 'Sign-up Failed', description: result.error, duration: 4000 });
      }
      // On success, browser opens. Auth state updates via deep-link callback.
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'An unexpected error occurred' });
    } finally {
      setOauthLoading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (!formData.name || !formData.dob || !formData.email) {
      setError('Please fill in all fields');
      return;
    }

    const dobDate = new Date(formData.dob);
    const age = new Date().getFullYear() - dobDate.getFullYear();
    if (age < 13) {
      setError('You must be at least 13 years old to sign up');
      return;
    }

    setIsLoading(true);
    try {
      if (window.electronAPI) {
        window.electronAPI.signUp({
          name: formData.name,
          dob: formData.dob,
          email: formData.email,
          password: formData.password,
        });
      } else {
        setError('This app requires Electron to run');
        setIsLoading(false);
      }
    } catch {
      setError('An unexpected error occurred');
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
          <button onClick={() => window.electronAPI?.windowControls?.minimize()} aria-label="Minimise" className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"><Minus className="w-3.5 h-3.5" /></button>
          <button onClick={() => window.electronAPI?.windowControls?.maximize()} aria-label="Maximise" className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"><Square className="w-3 h-3" /></button>
          <button onClick={() => window.electronAPI?.windowControls?.close()} aria-label="Close" className="h-full w-11 flex items-center justify-center text-muted-foreground/40 hover:text-white hover:bg-red-500/80 transition-colors duration-150"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>
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
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-emerald/6 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <Logo size="w-9 h-9" />
          <span className="font-bold text-foreground text-lg tracking-tight">Prmpt</span>
        </div>

        <div className="relative z-10 space-y-6">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-muted text-emerald text-xs font-semibold tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald animate-pulse-subtle" />
              Free to start
            </div>
            <h1 className="text-3xl font-bold text-foreground leading-tight">
              Join thousands of<br />
              <span className="text-gradient-primary">prompt engineers.</span>
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
              Create an account and start optimizing your prompts for maximum clarity and performance.
            </p>
          </div>

          <div className="space-y-3">
            {[
              { label: 'Unlimited chat history', desc: 'Never lose a great prompt' },
              { label: 'Smart library', desc: 'Organize with collections' },
              { label: 'Voice input', desc: 'Dictate your prompts' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-emerald/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs text-muted-foreground/50 italic">
          "The quality of your output begins with the quality of your input."
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[380px] space-y-7 animate-fade-in">
          {/* Mobile brand */}
          <div className="flex items-center gap-3 lg:hidden">
            <Logo size="w-8 h-8" />
            <span className="font-bold text-foreground">Prmpt</span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Create your account</h2>
            <p className="text-sm text-muted-foreground">Free forever. No credit card required.</p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-destructive/8 border border-destructive/20 animate-slide-up">
              <div className="w-4 h-4 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
              </div>
              <p className="text-sm text-destructive leading-snug">{error}</p>
            </div>
          )}

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
                <Loader2 className="w-4 h-4 animate-spin" />
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
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Github className="w-4 h-4 flex-shrink-0" />
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
              <span className="bg-background px-3 text-muted-foreground">Or create an account with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-sm font-medium text-foreground">Full name</Label>
                <Input
                  id="name" name="name" type="text" placeholder="John Doe"
                  value={formData.name} onChange={handleChange}
                  required autoComplete="name" disabled={isLoading}
                  className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground placeholder:text-muted-foreground/60 transition-button"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dob" className="text-sm font-medium text-foreground">Date of birth</Label>
                <Input
                  id="dob" name="dob" type="date"
                  value={formData.dob} onChange={handleChange}
                  required disabled={isLoading}
                  max={new Date().toISOString().split('T')[0]}
                  className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground transition-button"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-foreground">Email address</Label>
              <Input
                id="email" name="email" type="email" placeholder="you@example.com"
                value={formData.email} onChange={handleChange}
                required autoComplete="email" disabled={isLoading}
                className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground placeholder:text-muted-foreground/60 transition-button"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium text-foreground">Password</Label>
              <Input
                id="password" name="password" type="password" placeholder="••••••••"
                value={formData.password} onChange={handleChange}
                required autoComplete="new-password" disabled={isLoading} minLength={6}
                className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground placeholder:text-muted-foreground/60 transition-button"
              />
              <p className="text-xs text-muted-foreground">Minimum 6 characters</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">Confirm password</Label>
              <Input
                id="confirmPassword" name="confirmPassword" type="password" placeholder="••••••••"
                value={formData.confirmPassword} onChange={handleChange}
                required autoComplete="new-password" disabled={isLoading} minLength={6}
                className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground placeholder:text-muted-foreground/60 transition-button"
              />
            </div>

            <Button
              type="submit" disabled={isLoading}
              className="w-full h-10 bg-emerald hover:bg-emerald/90 text-white font-semibold glow-emerald-sm transition-button mt-1"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <span className="flex items-center gap-2">
                  Create Account
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-3 text-muted-foreground">Already have an account?</span>
            </div>
          </div>

          <Button
            type="button" variant="outline" onClick={onSwitchToLogin} disabled={isLoading || !!oauthLoading}
            className="w-full h-10 border-border text-foreground hover:bg-secondary font-medium transition-button"
          >
            Sign in instead
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Logo } from "@/components/ui/Logo";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap, ArrowRight, Loader2, Minus, Square, X } from 'lucide-react';

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
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
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
            type="button" variant="outline" onClick={onSwitchToLogin} disabled={isLoading}
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

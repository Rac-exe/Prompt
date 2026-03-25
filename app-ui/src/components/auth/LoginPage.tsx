import { useState, useEffect } from 'react';
import { Logo } from "@/components/ui/Logo";
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap, ArrowRight, Loader2 } from 'lucide-react';

interface LoginPageProps {
  onSwitchToSignup: () => void;
  onLoginSuccess: () => void;
  error?: string | null;
}

export function LoginPage({ onSwitchToSignup, onLoginSuccess, error: externalError }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (externalError) {
      setIsLoading(false);
      setPassword('');
      setEmail('');
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: externalError,
        duration: 4000,
      });
    }
  }, [externalError, toast]);

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
    <div className="min-h-screen flex bg-background">
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
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <span className="flex items-center gap-2">
                  Sign In
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </Button>
          </form>

          {/* Divider */}
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
            disabled={isLoading}
            className="w-full h-10 border-border text-foreground hover:bg-secondary hover:border-border font-medium transition-button"
          >
            Create an account
          </Button>
        </div>
      </div>
    </div>
  );
}

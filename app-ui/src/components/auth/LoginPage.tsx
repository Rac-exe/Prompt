import { useState, useEffect } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface LoginPageProps {
  onSwitchToSignup: () => void;
  onLoginSuccess: () => void;
  error?: string | null;
}

export function LoginPage({ onSwitchToSignup, onLoginSuccess, error: externalError }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [internalError, setInternalError] = useState('');
  const { toast } = useToast();

  // Handle external errors (from AuthWrapper)
  useEffect(() => {
    if (externalError) {
      setIsLoading(false);
      // Clear password field for security, and email if desired (user requested both)
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

    if (isLoading) return; // Prevent duplicate submissions

    setInternalError('');
    setIsLoading(true);

    try {
      if (window.electronAPI) {
        // Send login request to Electron
        window.electronAPI.signIn({ email, password });
        // The response will come through onAuthStateChange listener in AuthWrapper
      } else {
        const msg = 'This app requires Electron to run';
        setInternalError(msg);
        setIsLoading(false);
        toast({
          variant: "destructive",
          title: "System Error",
          description: msg,
        });
      }
    } catch (err) {
      console.error('[LoginPage] Error during login:', err);
      const msg = 'An unexpected error occurred';
      setInternalError(msg);
      setIsLoading(false);
      toast({
        variant: "destructive",
        title: "Error",
        description: msg,
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Welcome Back</CardTitle>
          <CardDescription className="text-center">
            Sign in to your Prompt Optimizer account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Inline error removed in favor of Toast */}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
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
              />
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>

            <div className="text-center text-sm text-gray-600 dark:text-gray-400">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={onSwitchToSignup}
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                disabled={isLoading}
              >
                Sign up
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { Logo } from "@/components/ui/Logo";
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';
import { OnboardingPage } from './OnboardingPage';
import { AuthContext, CompleteUserData } from '@/context/AuthContext';
import { useToast } from "@/hooks/use-toast";

interface AuthWrapperProps {
  children: ReactNode;
}

type AuthView = 'loading' | 'login' | 'signup' | 'onboarding' | 'app';

const ONBOARDING_KEY_PREFIX = 'onboarding-completed-';

export function AuthWrapper({ children }: AuthWrapperProps) {
  const [authView, setAuthView] = useState<AuthView>('loading');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<CompleteUserData | null>(null);
  const { toast } = useToast();

  // Track the view that was active when auth fires so we know if user just signed up
  const authViewRef = useRef<AuthView>('loading');
  authViewRef.current = authView;

  const handleSignOut = useCallback(() => {
    if (window.electronAPI?.signOut) {
      window.electronAPI.signOut();
      setUser(null);
      setAuthView('login');
      toast({
        title: "Signed out",
        description: "You have been signed out successfully.",
      });
    }
  }, [toast]);

  useEffect(() => {
    console.log('[AuthWrapper] Initializing');

    // Check if we're in Electron
    if (!window.electronAPI) {
      console.error('[AuthWrapper] window.electronAPI not found');
      setAuthView('login');
      setError('This app must run in Electron');
      return;
    }

    // Set up auth state change listener
    window.electronAPI.onAuthStateChange((data: { isAuthenticated: boolean; user: any; error?: string }) => {
      console.log('[AuthWrapper] Auth state changed:', {
        isAuthenticated: data.isAuthenticated,
        hasUser: !!data.user,
        error: data.error
      });

      if (data.error) {
        setError(data.error);
        setAuthView('login');
        setUser(null);
      } else if (data.isAuthenticated && data.user) {
        // user data from backend matches CompleteUserData structure
        setUser(data.user);
        setError(null);

        // Only show onboarding if the user JUST signed up (authView was 'signup')
        const cameFromSignup = authViewRef.current === 'signup';

        if (cameFromSignup) {
          // Fresh signup → show onboarding
          setAuthView('onboarding');
        } else {
          // Returning user (login / app re-launch) → go straight to app
          setAuthView('app');
        }
      } else {
        setAuthView('login');
        setUser(null);
      }
    });

    // Listen for profile updates (e.g. avatar change) — updates user state in real-time
    if (window.electronAPI.onUserDataLoaded) {
      window.electronAPI.onUserDataLoaded((userData: any) => {
        console.log('[AuthWrapper] user-data-loaded — refreshing user state');
        if (userData) {
          setUser(userData);
        }
      });
    }

    // Check current auth status
    window.electronAPI.checkAuth();
  }, []);

  // Debug: Log current state before render
  console.log('[AuthWrapper] Current authView:', authView);

  const renderContent = () => {
    if (authView === 'loading') {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-5">
            <Logo size="w-16 h-16" />
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald"></div>
          </div>
        </div>
      );
    }

    if (authView === 'signup') {
      return (
        <SignupPage
          onSwitchToLogin={() => {
            setAuthView('login');
            setError(null);
          }}
          onSignupSuccess={() => {
            // Don't set authView here - let the auth state change event handle it
          }}
        />
      );
    }

    if (authView === 'login') {
      return (
        <LoginPage
          onSwitchToSignup={() => {
            setAuthView('signup');
            setError(null);
          }}
          onLoginSuccess={() => {
            // Don't set authView here - let the auth state change event handle it
          }}
          error={error}
        />
      );
    }

    if (authView === 'onboarding') {
      return (
        <OnboardingPage
          userName={user?.profile?.name?.split(' ')[0]}
          onComplete={() => {
            // Mark onboarding as completed for this user
            const userId = user?.profile?.id;
            if (userId) {
              localStorage.setItem(`${ONBOARDING_KEY_PREFIX}${userId}`, 'true');
            }
            setAuthView('app');
          }}
        />
      );
    }

    // authView === 'app' - User is authenticated, render main app
    console.log('[AuthWrapper] Rendering main app');
    return <>{children}</>;
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading: authView === 'loading',
      signOut: handleSignOut
    }}>
      {renderContent()}
    </AuthContext.Provider>
  );
}

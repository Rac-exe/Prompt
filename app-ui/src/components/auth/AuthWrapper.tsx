import { useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { Logo } from "@/components/ui/Logo";
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';
import { OnboardingPage } from './OnboardingPage';
import { AuthContext, CompleteUserData } from '@/context/AuthContext';
import { ZoomIndicator } from '@/components/layout/ZoomIndicator';

interface AuthWrapperProps {
  children: ReactNode;
}

type AuthView = 'loading' | 'login' | 'signup' | 'onboarding' | 'app';

const ONBOARDING_KEY_PREFIX = 'onboarding-completed-';
const AUTH_SLOW_MS = 6_000;
const AUTH_RETRY_MS = 12_000;
const AUTH_GIVEUP_MS = 20_000;

export function AuthWrapper({ children }: AuthWrapperProps) {
  const [authView, setAuthView] = useState<AuthView>('loading');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<CompleteUserData | null>(null);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const giveupTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleSignOut = useCallback(() => {
    if (window.electronAPI?.signOut) {
      window.electronAPI.signOut();
      setUser(null);
      setAuthView('login');
    }
  }, []);

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

        // Show onboarding only for genuinely NEW users.
        // We combine two signals:
        //   1. localStorage key — set when onboarding is completed
        //   2. profile.created_at — if the account is older than 2 minutes,
        //      the user is returning (not new), even if localStorage is missing
        //      (e.g. app reinstall, cleared storage, or pre-existing account).
        const userId = data.user?.profile?.id || data.user?.id;
        const onboardingKey = userId ? `${ONBOARDING_KEY_PREFIX}${userId}` : null;
        const markedComplete = onboardingKey
          ? localStorage.getItem(onboardingKey) === 'true'
          : true; // safety: skip onboarding if we can't identify the user

        if (markedComplete) {
          // Already completed onboarding → straight to app
          setAuthView('app');
        } else {
          // Check if account was just created (within the last 2 minutes)
          const createdAt = data.user?.profile?.created_at;
          const isNewAccount = createdAt
            ? (Date.now() - new Date(createdAt).getTime()) < 2 * 60 * 1000
            : false; // if we can't determine age, assume existing user

          if (isNewAccount) {
            // Genuinely new signup → show onboarding
            setAuthView('onboarding');
          } else {
            // Existing user without localStorage key → mark as done, skip
            if (onboardingKey) {
              localStorage.setItem(onboardingKey, 'true');
            }
            setAuthView('app');
          }
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

  useEffect(() => {
    if (authView !== 'loading') {
      setLoadingSlow(false);
      clearTimeout(retryTimer.current);
      clearTimeout(giveupTimer.current);
      return;
    }

    const slowTimer = setTimeout(() => setLoadingSlow(true), AUTH_SLOW_MS);

    retryTimer.current = setTimeout(() => {
      if (authView === 'loading' && window.electronAPI) {
        console.warn('[AuthWrapper] Still loading after', AUTH_RETRY_MS, 'ms — retrying checkAuth');
        window.electronAPI.checkAuth();
      }
    }, AUTH_RETRY_MS);

    giveupTimer.current = setTimeout(() => {
      setAuthView((current) => {
        if (current !== 'loading') return current;
        console.error('[AuthWrapper] Still loading after', AUTH_GIVEUP_MS, 'ms — falling back to login');
        return 'login';
      });
    }, AUTH_GIVEUP_MS);

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(retryTimer.current);
      clearTimeout(giveupTimer.current);
    };
  }, [authView]);

  // Debug: Log current state before render
  console.log('[AuthWrapper] Current authView:', authView);

  const renderContent = () => {
    if (authView === 'loading') {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-5">
            <Logo size="w-16 h-16" />
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald"></div>
            {loadingSlow && (
              <p className="text-sm text-muted-foreground animate-fade-in">
                Taking longer than usual&hellip;
              </p>
            )}
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
      {authView !== 'app' && <ZoomIndicator />}
    </AuthContext.Provider>
  );
}

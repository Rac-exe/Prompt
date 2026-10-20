import { useState, useEffect, ReactNode } from 'react';
import { Logo } from "@/components/ui/Logo";
import { OnboardingPage } from './OnboardingPage';
import { AuthContext, CompleteUserData } from '@/context/AuthContext';
import { ZoomIndicator } from '@/components/layout/ZoomIndicator';

interface AuthWrapperProps {
  children: ReactNode;
}

type AppView = 'loading' | 'error' | 'onboarding' | 'ai-setup' | 'app';

const ONBOARDING_DONE_KEY = 'prmpt-onboarding-completed';

function onboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DONE_KEY) === 'true';
  } catch {
    return false;
  }
}

function markOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
  } catch {
    /* not critical: onboarding shows again next time */
  }
}

const LOADING_SLOW_MS = 6_000;

/**
 * App gate. There is no login: the main process sends the local user once the
 * local database is open. The first launch shows onboarding (theme, AI
 * provider, feature tour). Later launches with no OpenRouter key yet show just
 * the AI provider step, which can be skipped.
 */
export function AuthWrapper({ children }: AuthWrapperProps) {
  const [view, setView] = useState<AppView>('loading');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<CompleteUserData | null>(null);
  const [loadingSlow, setLoadingSlow] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) {
      setError('Prmpt must run inside its desktop app.');
      setView('error');
      return;
    }

    window.electronAPI.onAuthStateChange(async (data: { isAuthenticated: boolean; user: any; error?: string }) => {
      if (data.error || !data.user) {
        setError(data.error || 'Could not load your local data.');
        setView('error');
        return;
      }
      setUser(data.user);
      setError(null);
      const ai = await window.electronAPI.aiSettings.get().catch(() => null);
      setView((current) => {
        if (current === 'app' || current === 'onboarding' || current === 'ai-setup') return current;
        if (ai?.configured) return 'app';
        return onboardingDone() ? 'ai-setup' : 'onboarding';
      });
    });

    // Profile updates (e.g. avatar or name change) refresh the user in place
    window.electronAPI.onUserDataLoaded?.((userData: any) => {
      if (userData) setUser(userData);
    });

    window.electronAPI.checkAuth();
  }, []);

  useEffect(() => {
    if (view !== 'loading') {
      setLoadingSlow(false);
      return;
    }
    const timer = setTimeout(() => setLoadingSlow(true), LOADING_SLOW_MS);
    return () => clearTimeout(timer);
  }, [view]);

  const renderContent = () => {
    if (view === 'loading' || view === 'error') {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-5 max-w-sm text-center">
            <Logo size="w-16 h-16" />
            {view === 'loading' ? (
              <>
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald"></div>
                {loadingSlow && (
                  <p className="text-sm text-muted-foreground animate-fade-in">Taking longer than usual&hellip;</p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-destructive">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setView('loading');
                    window.electronAPI?.checkAuth();
                  }}
                  className="h-9 px-4 rounded-xl text-sm border border-input hover:bg-muted"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        </div>
      );
    }

    if (view === 'onboarding') {
      return (
        <OnboardingPage
          userName={user?.profile?.name?.split(' ')[0]}
          onComplete={() => {
            markOnboardingDone();
            setView('app');
          }}
        />
      );
    }

    if (view === 'ai-setup') {
      return <OnboardingPage aiProviderOnly onComplete={() => setView('app')} />;
    }

    return <>{children}</>;
  };

  return (
    <AuthContext.Provider value={{ user, isLoading: view === 'loading' }}>
      {renderContent()}
      {view !== 'app' && <ZoomIndicator />}
    </AuthContext.Provider>
  );
}

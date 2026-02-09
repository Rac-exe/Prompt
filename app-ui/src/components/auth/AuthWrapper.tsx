import { useState, useEffect, ReactNode } from 'react';
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';

interface AuthWrapperProps {
  children: ReactNode;
}

type AuthView = 'loading' | 'login' | 'signup' | 'app';

export function AuthWrapper({ children }: AuthWrapperProps) {
  const [authView, setAuthView] = useState<AuthView>('loading');
  const [error, setError] = useState<string | null>(null);

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
      } else if (data.isAuthenticated && data.user) {
        setAuthView('app');
      } else {
        setAuthView('login');
      }
    });

    // Check current auth status
    window.electronAPI.checkAuth();
  }, []);

  // Debug: Log current state before render
  console.log('[AuthWrapper] Current authView:', authView);

  // Render based on auth view state (SINGLE source of truth)
  if (authView === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
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

  // authView === 'app' - User is authenticated, render main app
  console.log('[AuthWrapper] Rendering main app');
  return <>{children}</>;
}

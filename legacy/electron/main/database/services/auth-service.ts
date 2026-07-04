import * as Sentry from '@sentry/electron/main';
import { SupabaseClientManager } from '../supabase-client';
import { AuthError, Session, User as SupabaseUser } from '@supabase/supabase-js';

export interface SignUpData {
  name: string;
  dob: string; // ISO date string (YYYY-MM-DD)
  email: string;
  password: string;
}

export interface SignInData {
  email: string;
  password: string;
}

export interface AuthState {
  user: SupabaseUser | null;
  session: Session | null;
  isAuthenticated: boolean;
}

/**
 * Authentication Service
 * Handles all auth-related operations: signup, signin, signout, session management
 *
 * Sentry instrumentation:
 *   - Actionful methods (signIn, signUp, signOut, OAuth, exchangeCodeForSession,
 *     linkIdentity, unlinkIdentity, resetPasswordForEmail, updatePassword,
 *     updateEmail) are wrapped in startSpan for end-to-end traces.
 *   - Every catch block captures the unexpected error (the error returned from
 *     Supabase in the typed `error` field is intentionally NOT captured here —
 *     that's the IPC handler's job, since it has the user-facing context).
 */
export class AuthService {
  private client = SupabaseClientManager.getClient();

  /**
   * Sign up a new user with profile information
   */
  async signUp(data: SignUpData): Promise<{ user: SupabaseUser | null; error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.sign-up', op: 'auth.supabase', attributes: { email: data.email } },
      async (span) => {
        try {
          const { data: authData, error: authError } = await this.client.auth.signUp({
            email: data.email,
            password: data.password,
            options: {
              data: {
                name: data.name,
                dob: data.dob,
              },
            },
          });

          if (authError) {
            span.setAttribute('result', 'error');
            span.setAttribute('error_code', authError.status ?? 0);
            console.error('[AuthService] Signup error:', authError);
            return { user: null, error: authError };
          }

          if (!authData.user) {
            span.setAttribute('result', 'no-user');
            return { user: null, error: new Error('User creation failed') as AuthError };
          }

          const { error: profileError } = await this.client
            .from('profiles')
            .update({
              name: data.name,
              dob: data.dob,
            })
            .eq('id', authData.user.id);

          if (profileError) {
            // Non-fatal: trigger handle_new_user() created the basic profile already.
            Sentry.captureException(profileError, {
              level: 'warning',
              tags: { component: 'auth-service', op: 'sign-up.profile-update' },
              extra: { userId: authData.user.id },
            });
            console.error('[AuthService] Profile update error:', profileError);
          }

          span.setAttribute('result', 'success');
          span.setAttribute('userId', authData.user.id);
          console.log('[AuthService] ✅ User signed up successfully:', data.email);
          return { user: authData.user, error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'sign-up' } });
          console.error('[AuthService] Unexpected signup error:', error);
          return {
            user: null,
            error: new Error(error instanceof Error ? error.message : 'Signup failed') as AuthError,
          };
        }
      },
    );
  }

  /**
   * Sign in an existing user
   */
  async signIn(data: SignInData): Promise<{ session: Session | null; error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.sign-in', op: 'auth.supabase', attributes: { email: data.email } },
      async (span) => {
        try {
          const { data: authData, error } = await this.client.auth.signInWithPassword({
            email: data.email,
            password: data.password,
          });

          if (error) {
            const isBanned = (error.message || '').toLowerCase().includes('banned');
            span.setAttribute('result', isBanned ? 'banned' : 'error');
            span.setAttribute('error_code', error.status ?? 0);
            console.error('[AuthService] Sign in error:', error);
            return { session: null, error };
          }

          span.setAttribute('result', 'success');
          if (authData.user?.id) span.setAttribute('userId', authData.user.id);
          console.log('[AuthService] ✅ User signed in:', data.email);
          return { session: authData.session, error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'sign-in' } });
          console.error('[AuthService] Unexpected sign in error:', error);
          return {
            session: null,
            error: new Error(error instanceof Error ? error.message : 'Sign in failed') as AuthError,
          };
        }
      },
    );
  }

  /**
   * Sign out the current user
   */
  async signOut(): Promise<{ error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.sign-out', op: 'auth.supabase' },
      async (span) => {
        try {
          const { error } = await this.client.auth.signOut();

          if (error) {
            span.setAttribute('result', 'error');
            console.error('[AuthService] Sign out error:', error);
            return { error };
          }

          span.setAttribute('result', 'success');
          console.log('[AuthService] ✅ User signed out');
          return { error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'sign-out' } });
          console.error('[AuthService] Unexpected sign out error:', error);
          return {
            error: new Error(error instanceof Error ? error.message : 'Sign out failed') as AuthError,
          };
        }
      },
    );
  }

  /**
   * Get current session — hot path, no span (called on every auth check).
   */
  async getSession(): Promise<{ session: Session | null; error: AuthError | null }> {
    try {
      const { data, error } = await this.client.auth.getSession();

      if (error) {
        console.error('[AuthService] Get session error:', error);
        return { session: null, error };
      }

      return { session: data.session, error: null };
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'auth-service', op: 'get-session' } });
      console.error('[AuthService] Unexpected get session error:', error);
      return {
        session: null,
        error: new Error(error instanceof Error ? error.message : 'Get session failed') as AuthError,
      };
    }
  }

  /**
   * Get current authenticated user — hot path, no span.
   */
  async getCurrentUser(): Promise<{ user: SupabaseUser | null; error: AuthError | null }> {
    try {
      const { data, error } = await this.client.auth.getUser();

      if (error) {
        console.error('[AuthService] Get user error:', error);
        return { user: null, error };
      }

      return { user: data.user, error: null };
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'auth-service', op: 'get-current-user' } });
      console.error('[AuthService] Unexpected get user error:', error);
      return {
        user: null,
        error: new Error(error instanceof Error ? error.message : 'Get user failed') as AuthError,
      };
    }
  }

  /**
   * Check if user is currently authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const { session } = await this.getSession();
    return !!session;
  }

  /**
   * Get complete auth state
   */
  async getAuthState(): Promise<AuthState> {
    const { session } = await this.getSession();
    const { user } = await this.getCurrentUser();

    return {
      user,
      session,
      isAuthenticated: !!(session && user),
    };
  }

  /**
   * Refresh the current session
   */
  async refreshSession(): Promise<{ session: Session | null; error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.refresh-session', op: 'auth.supabase' },
      async (span) => {
        try {
          const { data, error } = await this.client.auth.refreshSession();

          if (error) {
            span.setAttribute('result', 'error');
            console.error('[AuthService] Refresh session error:', error);
            return { session: null, error };
          }

          span.setAttribute('result', 'success');
          console.log('[AuthService] ✅ Session refreshed');
          return { session: data.session, error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'refresh-session' } });
          console.error('[AuthService] Unexpected refresh session error:', error);
          return {
            session: null,
            error: new Error(error instanceof Error ? error.message : 'Refresh failed') as AuthError,
          };
        }
      },
    );
  }

  /**
   * Listen for auth state changes
   */
  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    const { data: { subscription } } = this.client.auth.onAuthStateChange((event, session) => {
      console.log('[AuthService] Auth state changed:', event);
      callback(event, session);
    });

    return subscription;
  }

  /**
   * Update user password
   */
  async updatePassword(newPassword: string): Promise<{ error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.update-password', op: 'auth.supabase' },
      async (span) => {
        try {
          const { error } = await this.client.auth.updateUser({
            password: newPassword,
          });

          if (error) {
            span.setAttribute('result', 'error');
            console.error('[AuthService] Update password error:', error);
            return { error };
          }

          span.setAttribute('result', 'success');
          console.log('[AuthService] ✅ Password updated');
          return { error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'update-password' } });
          console.error('[AuthService] Unexpected update password error:', error);
          return {
            error: new Error(error instanceof Error ? error.message : 'Password update failed') as AuthError,
          };
        }
      },
    );
  }

  /**
   * Update user email
   */
  async updateEmail(newEmail: string): Promise<{ error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.update-email', op: 'auth.supabase' },
      async (span) => {
        try {
          const { error } = await this.client.auth.updateUser({
            email: newEmail,
          });

          if (error) {
            span.setAttribute('result', 'error');
            console.error('[AuthService] Update email error:', error);
            return { error };
          }

          span.setAttribute('result', 'success');
          console.log('[AuthService] ✅ Email update initiated (check email for confirmation)');
          return { error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'update-email' } });
          console.error('[AuthService] Unexpected update email error:', error);
          return {
            error: new Error(error instanceof Error ? error.message : 'Email update failed') as AuthError,
          };
        }
      },
    );
  }

  /**
   * Initiate OAuth sign-in with Google or GitHub (PKCE flow)
   * Returns the provider URL to open in the system browser.
   */
  async signInWithOAuth(
    provider: 'google' | 'github',
    redirectTo: string = 'http://127.0.0.1:54321/auth/callback',
  ): Promise<{ url: string | null; error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.oauth-sign-in', op: 'auth.supabase', attributes: { provider } },
      async (span) => {
        try {
          const { data, error } = await this.client.auth.signInWithOAuth({
            provider,
            options: {
              redirectTo,
              skipBrowserRedirect: true,
            },
          });

          if (error) {
            span.setAttribute('result', 'error');
            console.error(`[AuthService] OAuth sign-in error (${provider}):`, error);
            return { url: null, error };
          }

          span.setAttribute('result', 'success');
          console.log(`[AuthService] ✅ OAuth URL generated for ${provider}`);
          return { url: data.url, error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'oauth-sign-in', provider } });
          console.error('[AuthService] Unexpected OAuth sign-in error:', error);
          return {
            url: null,
            error: new Error(error instanceof Error ? error.message : 'OAuth sign-in failed') as AuthError,
          };
        }
      },
    );
  }

  /**
   * Exchange an OAuth authorization code for a Supabase session (PKCE step 2).
   *
   * Critical instrumentation point: this is where a banned (deletion-pending)
   * OAuth user surfaces — Supabase returns a "User is banned" error here.
   * We tag the span with `result=banned` so OAuth-blocked-by-deletion can be
   * dashboarded separately from generic OAuth failures.
   */
  async exchangeCodeForSession(code: string): Promise<{ session: Session | null; error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.exchange-code-for-session', op: 'auth.supabase' },
      async (span) => {
        try {
          const { data, error } = await this.client.auth.exchangeCodeForSession(code);

          if (error) {
            const isBanned = (error.message || '').toLowerCase().includes('banned');
            span.setAttribute('result', isBanned ? 'banned' : 'error');
            span.setAttribute('error_code', error.status ?? 0);
            console.error('[AuthService] Exchange code for session error:', error);
            return { session: null, error };
          }

          span.setAttribute('result', 'success');
          if (data.session?.user?.id) span.setAttribute('userId', data.session.user.id);
          console.log('[AuthService] ✅ Authorization code exchanged for session');
          return { session: data.session, error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'exchange-code' } });
          console.error('[AuthService] Unexpected exchange code error:', error);
          return {
            session: null,
            error: new Error(error instanceof Error ? error.message : 'Code exchange failed') as AuthError,
          };
        }
      },
    );
  }

  /**
   * Get all identities (providers) linked to the current user — hot path, no span.
   */
  async getIdentities(): Promise<{ identities: any[]; error: AuthError | null }> {
    try {
      const { data, error } = await this.client.auth.getUserIdentities();

      if (error) {
        console.error('[AuthService] Get identities error:', error);
        return { identities: [], error };
      }

      return { identities: data.identities ?? [], error: null };
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'auth-service', op: 'get-identities' } });
      console.error('[AuthService] Unexpected get identities error:', error);
      return {
        identities: [],
        error: new Error(error instanceof Error ? error.message : 'Get identities failed') as AuthError,
      };
    }
  }

  /**
   * Link a new OAuth provider to the current session (PKCE flow).
   * Returns the provider URL to open in the system browser.
   */
  async linkIdentity(
    provider: 'google' | 'github',
    redirectTo: string = 'http://127.0.0.1:54321/auth/callback',
  ): Promise<{ url: string | null; error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.link-identity', op: 'auth.supabase', attributes: { provider } },
      async (span) => {
        try {
          const { data, error } = await this.client.auth.linkIdentity({
            provider,
            options: {
              redirectTo,
              skipBrowserRedirect: true,
            },
          });

          if (error) {
            span.setAttribute('result', 'error');
            console.error(`[AuthService] Link identity error (${provider}):`, error);
            return { url: null, error };
          }

          span.setAttribute('result', 'success');
          console.log(`[AuthService] Link identity URL generated for ${provider}`);
          return { url: data.url, error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'link-identity', provider } });
          console.error('[AuthService] Unexpected link identity error:', error);
          return {
            url: null,
            error: new Error(error instanceof Error ? error.message : 'Link identity failed') as AuthError,
          };
        }
      },
    );
  }

  /**
   * Unlink an OAuth provider from the current user.
   * Requires the identity object from getUserIdentities().
   */
  async unlinkIdentity(identityId: string): Promise<{ error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.unlink-identity', op: 'auth.supabase', attributes: { identityId } },
      async (span) => {
        try {
          const { identities, error: fetchError } = await this.getIdentities();
          if (fetchError) {
            span.setAttribute('result', 'fetch-error');
            return { error: fetchError };
          }

          const identity = identities.find((i: any) => i.id === identityId);
          if (!identity) {
            span.setAttribute('result', 'not-found');
            return { error: new Error('Identity not found') as AuthError };
          }

          if (identities.length <= 1) {
            span.setAttribute('result', 'last-identity-blocked');
            return { error: new Error('Cannot remove last sign-in method') as AuthError };
          }

          span.setAttribute('provider', identity.provider);
          const { error } = await this.client.auth.unlinkIdentity(identity);

          if (error) {
            span.setAttribute('result', 'error');
            console.error('[AuthService] Unlink identity error:', error);
            return { error };
          }

          span.setAttribute('result', 'success');
          console.log(`[AuthService] Identity unlinked: ${identity.provider}`);
          return { error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'unlink-identity' } });
          console.error('[AuthService] Unexpected unlink identity error:', error);
          return {
            error: new Error(error instanceof Error ? error.message : 'Unlink identity failed') as AuthError,
          };
        }
      },
    );
  }

  /**
   * Send password reset email
   */
  async resetPasswordForEmail(email: string): Promise<{ error: AuthError | null }> {
    return Sentry.startSpan(
      { name: 'auth.reset-password-email', op: 'auth.supabase', attributes: { email } },
      async (span) => {
        try {
          const { error } = await this.client.auth.resetPasswordForEmail(email);

          if (error) {
            span.setAttribute('result', 'error');
            console.error('[AuthService] Reset password error:', error);
            return { error };
          }

          span.setAttribute('result', 'success');
          console.log('[AuthService] ✅ Password reset email sent to:', email);
          return { error: null };
        } catch (error) {
          span.setAttribute('result', 'unexpected-error');
          Sentry.captureException(error, { tags: { component: 'auth-service', op: 'reset-password-email' } });
          console.error('[AuthService] Unexpected reset password error:', error);
          return {
            error: new Error(error instanceof Error ? error.message : 'Password reset failed') as AuthError,
          };
        }
      },
    );
  }
}

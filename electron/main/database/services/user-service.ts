import * as Sentry from '@sentry/electron/main';
import { SupabaseClientManager } from '../supabase-client';
import { DeletionService } from './deletion-service';

export interface UserProfile {
  id: string;
  name: string;
  dob: string | null;
  email: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  user_id: string;
  personalization_prompt: string | null;
  ui_settings: {
    theme: string;
    default_model: string;
    shortcuts: {
      overlay_toggle: string;
    };
    optimization_preferences: {
      auto_optimize: boolean;
      show_diff: boolean;
      min_prompt_length: number;
    };
    privacy: {
      store_history: boolean;
      sync_across_devices: boolean;
    };
  };
  updated_at: string;
}

export interface CompleteUserData {
  profile: UserProfile;
  preferences: UserPreferences;
  hasEmailPassword: boolean;
}

/**
 * User Service
 * Handles user profile and preferences management
 */
export class UserService {
  private client = SupabaseClientManager.getClient();

  /**
   * Get current user's profile
   */
  async getUserProfile(): Promise<UserProfile | null> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user) return null;

      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .eq('id', userData.user.id)
        .single();

      if (error) {
        console.error('[UserService] Error fetching profile:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[UserService] Unexpected error fetching profile:', error);
      return null;
    }
  }

  /**
   * Get current user's preferences
   */
  async getUserPreferences(): Promise<UserPreferences | null> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user) return null;

      const { data, error } = await this.client
        .from('user_preferences')
        .select('*')
        .eq('user_id', userData.user.id)
        .single();

      if (error) {
        console.error('[UserService] Error fetching preferences:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[UserService] Unexpected error fetching preferences:', error);
      return null;
    }
  }

  /**
   * Re-create profile and preferences rows when they've been deleted
   * but the auth.users entry still exists (e.g. manual DB cleanup).
   */
  private async ensureProfileExists(user: { id: string; email?: string; user_metadata?: Record<string, any> }): Promise<void> {
    const { error: profileError } = await this.client
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email ?? '',
        name: user.user_metadata?.name || user.user_metadata?.full_name || 'User',
      }, { onConflict: 'id', ignoreDuplicates: true });

    if (profileError) {
      console.error('[UserService] Error ensuring profile exists:', profileError);
      Sentry.captureException(profileError, {
        tags: { component: 'user-service', op: 'ensure-profile:profile-upsert' },
        extra: { userId: user.id },
      });
    }

    const { error: prefsError } = await this.client
      .from('user_preferences')
      .upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });

    if (prefsError) {
      console.error('[UserService] Error ensuring preferences exist:', prefsError);
      Sentry.captureException(prefsError, {
        tags: { component: 'user-service', op: 'ensure-profile:prefs-upsert' },
        extra: { userId: user.id },
      });
    }
  }

  /**
   * Get complete user data (profile + preferences)
   */
  async getCompleteUserData(): Promise<CompleteUserData | null> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user) return null;

      let { data, error } = await this.client
        .from('user_full_profile')
        .select('*')
        .eq('id', userData.user.id)
        .single();

      if (error || !data) {
        console.warn('[UserService] Profile missing — re-creating for user', userData.user.id);
        Sentry.addBreadcrumb({
          category: 'user',
          message: 'Zombie profile detected — re-creating',
          level: 'warning',
          data: { userId: userData.user.id },
        });
        await this.ensureProfileExists(userData.user);

        const retry = await this.client
          .from('user_full_profile')
          .select('*')
          .eq('id', userData.user.id)
          .single();

        data = retry.data;
        error = retry.error;

        if (error || !data) {
          console.error('[UserService] Still cannot fetch profile after re-creation:', error);
          Sentry.captureException(error ?? new Error('Profile missing after re-creation'), {
            tags: { component: 'user-service', op: 'get-complete-user-data:retry-failed' },
            extra: { userId: userData.user.id },
          });
          return null;
        }
      }

      const profile: UserProfile = {
        id: data.id,
        name: data.name,
        dob: data.dob,
        email: data.email,
        avatar_url: data.avatar_url,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };

      const preferences: UserPreferences = {
        user_id: data.id,
        personalization_prompt: data.personalization_prompt,
        ui_settings: data.ui_settings,
        updated_at: data.updated_at,
      };

      // Detect whether this user has a password set in auth.users. Supabase
      // does NOT create an email identity row when a password is set via the
      // admin API for OAuth accounts, so we check the DB directly.
      let hasEmailPassword = false;
      try {
        const { data: hasPw } = await this.client.rpc('user_has_email_password');
        hasEmailPassword = hasPw === true;
      } catch {
        // Non-fatal: fall back to false; the localStorage flag will still work
      }

      return { profile, preferences, hasEmailPassword };
    } catch (error) {
      console.error('[UserService] Unexpected error fetching complete user data:', error);
      Sentry.captureException(error, { tags: { component: 'user-service', op: 'get-complete-user-data' } });
      return null;
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(updates: Partial<Omit<UserProfile, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const { error } = await this.client
        .from('profiles')
        .update(updates)
        .eq('id', userData.user.id);

      if (error) {
        console.error('[UserService] Error updating profile:', error);
        throw error;
      }

      console.log('[UserService] ✅ Profile updated');
    } catch (error) {
      console.error('[UserService] Unexpected error updating profile:', error);
      throw error;
    }
  }

  /**
   * Update user preferences
   */
  async updatePreferences(updates: Partial<Omit<UserPreferences, 'user_id' | 'updated_at'>>): Promise<void> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const { error } = await this.client
        .from('user_preferences')
        .update(updates)
        .eq('user_id', userData.user.id);

      if (error) {
        console.error('[UserService] Error updating preferences:', error);
        throw error;
      }

      console.log('[UserService] ✅ Preferences updated');
    } catch (error) {
      console.error('[UserService] Unexpected error updating preferences:', error);
      throw error;
    }
  }

  /**
   * Update UI settings (nested in preferences)
   */
  async updateUISettings(settings: Partial<UserPreferences['ui_settings']>): Promise<void> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      // Get current preferences
      const currentPrefs = await this.getUserPreferences();
      if (!currentPrefs) throw new Error('Preferences not found');

      // Merge settings
      const newUISettings = { ...currentPrefs.ui_settings, ...settings };

      const { error } = await this.client
        .from('user_preferences')
        .update({ ui_settings: newUISettings })
        .eq('user_id', userData.user.id);

      if (error) {
        console.error('[UserService] Error updating UI settings:', error);
        throw error;
      }

      console.log('[UserService] ✅ UI settings updated');
    } catch (error) {
      console.error('[UserService] Unexpected error updating UI settings:', error);
      throw error;
    }
  }

  /**
   * Set personalization prompt
   */
  async setPersonalizationPrompt(prompt: string): Promise<void> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const { error } = await this.client
        .from('user_preferences')
        .update({ personalization_prompt: prompt })
        .eq('user_id', userData.user.id);

      if (error) {
        console.error('[UserService] Error setting personalization prompt:', error);
        throw error;
      }

      console.log('[UserService] ✅ Personalization prompt updated');
    } catch (error) {
      console.error('[UserService] Unexpected error setting personalization prompt:', error);
      throw error;
    }
  }

  /**
   * Get personalization prompt (for use in optimizations)
   */
  async getPersonalizationPrompt(): Promise<string | null> {
    try {
      const preferences = await this.getUserPreferences();
      return preferences?.personalization_prompt || null;
    } catch (error) {
      console.error('[UserService] Error getting personalization prompt:', error);
      return null;
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const { data } = await this.client.auth.getUser();
    return !!data.user;
  }

  /**
   * Submit a 30-day deferred deletion request via the GDPR flow.
   * Actual data wipe is handled server-side by the process-deletions Edge Function.
   */
  async deleteAccount(reason?: string): Promise<{ scheduledAt: string }> {
    Sentry.addBreadcrumb({ category: 'user', message: 'Account deletion requested', level: 'info' });
    try {
      const svc = new DeletionService();
      const req = await svc.requestDeletion(reason);
      Sentry.addBreadcrumb({
        category: 'user',
        message: 'Account deletion scheduled',
        level: 'info',
        data: { scheduledAt: req.scheduled_deletion_at },
      });
      return { scheduledAt: req.scheduled_deletion_at };
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'user-service', op: 'delete-account' } });
      throw error;
    }
  }
}

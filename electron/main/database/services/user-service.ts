import { SupabaseClientManager } from '../supabase-client';

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
   * Get complete user data (profile + preferences)
   */
  async getCompleteUserData(): Promise<CompleteUserData | null> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user) return null;

      // Use the view for optimized query
      const { data, error } = await this.client
        .from('user_full_profile')
        .select('*')
        .eq('id', userData.user.id)
        .single();

      if (error) {
        console.error('[UserService] Error fetching complete user data:', error);
        return null;
      }

      // Transform the flat view data into structured format
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

      return { profile, preferences };
    } catch (error) {
      console.error('[UserService] Unexpected error fetching complete user data:', error);
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
   * Delete user account and all associated data
   */
  async deleteAccount(): Promise<void> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      // Note: Deleting from auth.users will cascade delete all user data
      // due to ON DELETE CASCADE constraints
      
      // This requires admin privileges or a database function
      // For now, just sign out and mark account for deletion
      console.warn('[UserService] Account deletion requires admin action');
      
      // In production, you would call an edge function or admin API here
      
      throw new Error('Account deletion not implemented yet');
    } catch (error) {
      console.error('[UserService] Error deleting account:', error);
      throw error;
    }
  }
}

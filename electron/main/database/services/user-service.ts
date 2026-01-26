import { SupabaseClientManager } from '../supabase-client';

export interface User {
  id: string;
  email: string;
  created_at: string;
  last_active: string;
  settings: {
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
}

export class UserService {
  private client = SupabaseClientManager.getClient();

  /**
   * Get current user profile
   */
  async getCurrentUser(): Promise<User | null> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) return null;

    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('id', userData.user.id)
      .single();

    if (error) {
      // If user doesn't exist in users table, create it
      if (error.code === 'PGRST116') {
        return this.createUser(userData.user.id, userData.user.email || '');
      }
      throw error;
    }

    return data;
  }

  /**
   * Create a new user profile
   */
  private async createUser(userId: string, email: string): Promise<User> {
    const { data, error } = await this.client
      .from('users')
      .insert({
        id: userId,
        email,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update user settings
   */
  async updateSettings(settings: Partial<User['settings']>): Promise<void> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    // Get current settings
    const currentUser = await this.getCurrentUser();
    if (!currentUser) throw new Error('User not found');

    // Merge settings
    const newSettings = { ...currentUser.settings, ...settings };

    const { error } = await this.client
      .from('users')
      .update({ settings: newSettings })
      .eq('id', userData.user.id);

    if (error) throw error;
  }

  /**
   * Update last active timestamp
   */
  async updateLastActive(): Promise<void> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) return;

    await this.client
      .from('users')
      .update({ last_active: new Date().toISOString() })
      .eq('id', userData.user.id);
  }

  /**
   * Sign in with email
   */
  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
  }

  /**
   * Sign up with email
   */
  async signUp(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signUp({
      email,
      password,
    });

    if (error) throw error;
  }

  /**
   * Sign out
   */
  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const { data } = await this.client.auth.getUser();
    return !!data.user;
  }
}

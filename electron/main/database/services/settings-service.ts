import { SupabaseClientManager } from '../supabase-client';

export interface UserSettings {
    user_id: string;
    theme: 'light' | 'dark';
    font_size: 'small' | 'medium' | 'large';
    font_family: 'inter' | 'mono' | 'serif';
    prompt_instructions: string;
    created_at?: string;
    updated_at?: string;
}

export const DEFAULT_SETTINGS: Omit<UserSettings, 'user_id' | 'created_at' | 'updated_at'> = {
    theme: 'dark',
    font_size: 'medium',
    font_family: 'inter',
    prompt_instructions: '',
};

/**
 * Settings Service
 * Handles user settings management in Supabase
 */
export class SettingsService {
    private client = SupabaseClientManager.getClient();

    /**
     * Get user settings from Supabase
     * Returns null if no settings found (new user)
     */
    async getUserSettings(userId: string): Promise<UserSettings | null> {
        try {
            const { data, error } = await this.client
                .from('user_settings')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    // No settings found - this is normal for new users
                    console.log(`[SettingsService] No settings found for user ${userId}, will use defaults`);
                    return null;
                }
                console.error('[SettingsService] Error fetching settings:', error);
                throw error;
            }

            console.log(`[SettingsService] ✅ Settings loaded from Supabase for user ${userId}:`, data);
            return data;
        } catch (error) {
            console.error('[SettingsService] Unexpected error fetching settings:', error);
            throw error;
        }
    }

    /**
     * Upsert (insert or update) user settings
     * Creates new settings if they don't exist, updates if they do
     */
    async upsertUserSettings(
        userId: string,
        settings: Partial<Omit<UserSettings, 'user_id' | 'created_at' | 'updated_at'>>
    ): Promise<UserSettings> {
        try {
            const { data, error } = await this.client
                .from('user_settings')
                .upsert({
                    user_id: userId,
                    ...settings,
                    updated_at: new Date().toISOString(),
                })
                .select()
                .single();

            if (error) {
                console.error(`[SettingsService] Error upserting settings for user ${userId}:`, error);
                throw error;
            }

            console.log(`[SettingsService] ✅ Settings saved to Supabase for user ${userId}:`, data);
            return data;
        } catch (error) {
            console.error('[SettingsService] Unexpected error upserting settings:', error);
            throw error;
        }
    }

    /**
     * Get settings or create with defaults if they don't exist
     */
    async getOrCreateSettings(userId: string): Promise<UserSettings> {
        try {
            const existing = await this.getUserSettings(userId);

            if (existing) {
                return existing;
            }

            // Create new settings with defaults
            console.log('[SettingsService] Creating default settings for new user');
            return await this.upsertUserSettings(userId, DEFAULT_SETTINGS);
        } catch (error) {
            console.error('[SettingsService] Error in getOrCreateSettings:', error);
            throw error;
        }
    }
}

import { getDb, nowIso, toBool } from '../local-db';

export interface UserSettings {
    user_id: string;
    theme: 'light' | 'dark';
    font_size: 'small' | 'medium' | 'large';
    font_family: 'inter' | 'mono' | 'serif';
    prompt_instructions: string;
    memory_enabled: boolean;
    created_at?: string;
    updated_at?: string;
}

export const DEFAULT_SETTINGS: Omit<UserSettings, 'user_id' | 'created_at' | 'updated_at'> = {
    theme: 'dark',
    font_size: 'medium',
    font_family: 'inter',
    prompt_instructions: '',
    memory_enabled: true,
};

type SettingsFields = Omit<UserSettings, 'user_id' | 'created_at' | 'updated_at'>;

function toSettings(row: any): UserSettings {
    return { ...row, memory_enabled: toBool(row.memory_enabled) };
}

/**
 * Settings Service
 * App settings (theme, typography, custom instructions, memory toggle),
 * stored in the local SQLite database.
 */
export class SettingsService {
    /**
     * Get user settings. Returns null if none have been saved yet.
     */
    async getUserSettings(userId: string): Promise<UserSettings | null> {
        const row = getDb().prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
        return row ? toSettings(row) : null;
    }

    /**
     * Upsert (insert or update) user settings.
     * Fields not passed keep their current (or default) value.
     */
    async upsertUserSettings(
        userId: string,
        settings: Partial<SettingsFields>
    ): Promise<UserSettings> {
        const current = await this.getUserSettings(userId);
        const merged: SettingsFields = {
            ...DEFAULT_SETTINGS,
            ...(current ?? {}),
            ...settings,
        };
        const now = nowIso();
        getDb()
            .prepare(
                `INSERT INTO user_settings
                   (user_id, theme, font_size, font_family, prompt_instructions, memory_enabled, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET
                   theme = excluded.theme,
                   font_size = excluded.font_size,
                   font_family = excluded.font_family,
                   prompt_instructions = excluded.prompt_instructions,
                   memory_enabled = excluded.memory_enabled,
                   updated_at = excluded.updated_at`,
            )
            .run(
                userId,
                merged.theme,
                merged.font_size,
                merged.font_family,
                merged.prompt_instructions ?? '',
                merged.memory_enabled === false ? 0 : 1,
                current?.created_at ?? now,
                now,
            );
        return (await this.getUserSettings(userId)) as UserSettings;
    }

    /**
     * Get settings or create with defaults if they don't exist
     */
    async getOrCreateSettings(userId: string): Promise<UserSettings> {
        const existing = await this.getUserSettings(userId);
        if (existing) return existing;
        return this.upsertUserSettings(userId, DEFAULT_SETTINGS);
    }
}

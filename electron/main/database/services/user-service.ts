import * as os from 'os';
import { getDb, LOCAL_USER_ID, nowIso, toJson, fromJson } from '../local-db';

export interface UserProfile {
  id: string;
  name: string;
  dob: string | null;
  email: string;
  avatar_url: string | null;
  avatar_public_id: string | null;
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

const DEFAULT_UI_SETTINGS: UserPreferences['ui_settings'] = {
  theme: 'dark',
  default_model: '',
  shortcuts: { overlay_toggle: 'Ctrl+5' },
  optimization_preferences: { auto_optimize: true, show_diff: true, min_prompt_length: 10 },
  privacy: { store_history: true, sync_across_devices: false },
};

function defaultName(): string {
  try {
    const name = os.userInfo().username;
    if (name) return name;
  } catch {
    // userInfo can throw when the account has no username entry
  }
  return 'You';
}

/**
 * User Service
 * The single local profile and its preferences, stored in the local SQLite
 * database. The profile row is created on first use.
 */
export class UserService {
  private getRow(): any {
    const conn = getDb();
    let row = conn.prepare('SELECT * FROM profile WHERE id = ?').get(LOCAL_USER_ID);
    if (!row) {
      const now = nowIso();
      conn
        .prepare(
          `INSERT INTO profile (id, name, email, avatar_url, personalization_prompt, ui_settings, created_at, updated_at)
           VALUES (?, ?, '', NULL, NULL, ?, ?, ?)`,
        )
        .run(LOCAL_USER_ID, defaultName(), toJson(DEFAULT_UI_SETTINGS), now, now);
      row = conn.prepare('SELECT * FROM profile WHERE id = ?').get(LOCAL_USER_ID);
    }
    return row;
  }

  /**
   * Get the local profile
   */
  async getUserProfile(): Promise<UserProfile | null> {
    const row = this.getRow();
    return {
      id: row.id,
      name: row.name,
      dob: null,
      email: row.email || '',
      avatar_url: row.avatar_url ?? null,
      avatar_public_id: null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Get the local preferences
   */
  async getUserPreferences(): Promise<UserPreferences | null> {
    const row = this.getRow();
    return {
      user_id: row.id,
      personalization_prompt: row.personalization_prompt ?? null,
      ui_settings: { ...DEFAULT_UI_SETTINGS, ...fromJson(row.ui_settings, {}) },
      updated_at: row.updated_at,
    };
  }

  /**
   * Profile + preferences in the shape the renderer expects.
   */
  async getCompleteUserData(_userId?: string): Promise<CompleteUserData | null> {
    const profile = await this.getUserProfile();
    const preferences = await this.getUserPreferences();
    if (!profile || !preferences) return null;
    return { profile, preferences, hasEmailPassword: false };
  }

  /**
   * Update profile fields (name, avatar_url)
   */
  async updateProfile(updates: Partial<Omit<UserProfile, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    const current = this.getRow();
    const name = typeof updates.name === 'string' && updates.name.trim() ? updates.name.trim() : current.name;
    const avatarUrl = updates.avatar_url !== undefined ? updates.avatar_url : current.avatar_url;
    getDb()
      .prepare('UPDATE profile SET name = ?, avatar_url = ?, updated_at = ? WHERE id = ?')
      .run(name, avatarUrl, nowIso(), LOCAL_USER_ID);
  }

  /**
   * Update preferences (personalization prompt and/or ui_settings)
   */
  async updatePreferences(updates: Partial<Omit<UserPreferences, 'user_id' | 'updated_at'>>): Promise<void> {
    const current = await this.getUserPreferences();
    const prompt = updates.personalization_prompt !== undefined
      ? updates.personalization_prompt
      : current?.personalization_prompt ?? null;
    const uiSettings = updates.ui_settings ?? current?.ui_settings ?? DEFAULT_UI_SETTINGS;
    getDb()
      .prepare('UPDATE profile SET personalization_prompt = ?, ui_settings = ?, updated_at = ? WHERE id = ?')
      .run(prompt, toJson(uiSettings), nowIso(), LOCAL_USER_ID);
  }

  /**
   * Update UI settings (merged into the current ones)
   */
  async updateUISettings(settings: Partial<UserPreferences['ui_settings']>): Promise<void> {
    const current = await this.getUserPreferences();
    await this.updatePreferences({ ui_settings: { ...(current?.ui_settings ?? DEFAULT_UI_SETTINGS), ...settings } });
  }

  /**
   * Set personalization prompt
   */
  async setPersonalizationPrompt(prompt: string): Promise<void> {
    await this.updatePreferences({ personalization_prompt: prompt });
  }

  /**
   * Get personalization prompt (for use in optimizations)
   */
  async getPersonalizationPrompt(): Promise<string | null> {
    const preferences = await this.getUserPreferences();
    return preferences?.personalization_prompt || null;
  }
}

import { createContext, useContext } from 'react';

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

/** The local user (there is no login) and its profile/preferences. */
interface AuthContextType {
    user: CompleteUserData | null;
    isLoading: boolean;
}

export const AuthContext = createContext<AuthContextType>({
    user: null,
    isLoading: true,
});

export const useAuth = () => useContext(AuthContext);

import * as Sentry from '@sentry/react';

export interface SettingsData {
    theme: "light" | "dark";
    fontSize: "small" | "medium" | "large";
    fontFamily: "inter" | "mono" | "serif";
    promptInstructions: string;
}

export const STORAGE_KEY = "prompt-weaver-settings";

// Default settings — light for first-time users; stored preference takes over on return visits.
export const DEFAULT_SETTINGS: SettingsData = {
    theme: "light",
    fontSize: "medium",
    fontFamily: "inter",
    promptInstructions: "",
};

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI;

// Load settings from Supabase (via Electron) or localStorage
export const loadSettings = async (): Promise<SettingsData> => {
    if (isElectron && window.electronAPI.loadSettings) {
        try {
            // Load from Supabase via Electron
            const settings = await window.electronAPI.loadSettings();

            // Transform snake_case from DB to camelCase for frontend
            const transformed: SettingsData = {
                theme: settings.theme || DEFAULT_SETTINGS.theme,
                fontSize: settings.font_size || DEFAULT_SETTINGS.fontSize,
                fontFamily: settings.font_family || DEFAULT_SETTINGS.fontFamily,
                promptInstructions: settings.prompt_instructions || DEFAULT_SETTINGS.promptInstructions,
            };

            localStorage.setItem(STORAGE_KEY, JSON.stringify(transformed));
            Sentry.addBreadcrumb({ category: 'settings', message: 'Loaded from Supabase', level: 'info', data: { theme: transformed.theme, fontSize: transformed.fontSize, fontFamily: transformed.fontFamily } });
            return transformed;
        } catch (error) {
            Sentry.captureException(error, { tags: { component: 'settings', op: 'load' } });
            console.error('[Settings] Failed to load from Supabase:', error);
        }
    }

    // Fallback: Load from localStorage (for non-Electron or error)
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch {
            // Fall through to defaults
        }
    }
    return DEFAULT_SETTINGS;
};

// Save settings to Supabase (via Electron) and localStorage
export const saveSettings = async (settings: SettingsData): Promise<void> => {
    // Write locally FIRST so the preference survives sign-out or app close
    // before the Supabase round-trip completes.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

    if (isElectron && window.electronAPI.saveSettings) {
        try {
            // Transform camelCase to snake_case for DB
            const dbSettings = {
                theme: settings.theme,
                font_size: settings.fontSize,
                font_family: settings.fontFamily,
                prompt_instructions: settings.promptInstructions,
            };

            await window.electronAPI.saveSettings(dbSettings);
            Sentry.addBreadcrumb({ category: 'settings', message: 'Saved to Supabase', level: 'info', data: { theme: settings.theme, fontSize: settings.fontSize } });
        } catch (error) {
            Sentry.captureException(error, { tags: { component: 'settings', op: 'save' } });
            console.error('[Settings] Failed to save to Supabase:', error);
        }
    }
};

// Apply settings to the DOM
export const applySettings = (settings: SettingsData) => {
    const root = document.documentElement;
    Sentry.addBreadcrumb({ category: 'settings', message: 'Applied to DOM', level: 'info', data: { theme: settings.theme, fontSize: settings.fontSize, fontFamily: settings.fontFamily } });

    if (settings.theme === "dark") {
        root.classList.add("dark");
    } else {
        root.classList.remove("dark");
    }

    // Remove existing font/size classes
    root.classList.remove('text-sm', 'text-base', 'text-lg');
    root.classList.remove('font-sans', 'font-mono', 'font-serif');

    // Apply font size
    switch (settings.fontSize) {
        case "small":
            root.classList.add('text-sm');
            break;
        case "large":
            root.classList.add('text-lg');
            break;
        default:
            root.classList.add('text-base');
    }

    // Apply font family
    switch (settings.fontFamily) {
        case "mono":
            root.classList.add('font-mono');
            break;
        case "serif":
            root.classList.add('font-serif');
            break;
        default:
            root.classList.add('font-sans');
    }
};

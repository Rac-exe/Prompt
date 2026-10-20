
export interface SettingsData {
    theme: "light" | "dark";
    fontSize: "small" | "medium" | "large";
    fontFamily: "inter" | "mono" | "serif";
    promptInstructions: string;
}

export const STORAGE_KEY = "prompt-weaver-settings";

export function storageKey(userId?: string): string {
    return userId ? `${STORAGE_KEY}-${userId}` : STORAGE_KEY;
}

// Default settings — light for first-time users; stored preference takes over on return visits.
export const DEFAULT_SETTINGS: SettingsData = {
    theme: "light",
    fontSize: "medium",
    fontFamily: "inter",
    promptInstructions: "",
};

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI;

// Load settings from the local database (via Electron) or localStorage
export const loadSettings = async (userId?: string): Promise<SettingsData> => {
    const key = storageKey(userId);
    if (isElectron && window.electronAPI.loadSettings) {
        try {
            const settings = await window.electronAPI.loadSettings();

            const transformed: SettingsData = {
                theme: settings.theme || DEFAULT_SETTINGS.theme,
                fontSize: settings.font_size || DEFAULT_SETTINGS.fontSize,
                fontFamily: settings.font_family || DEFAULT_SETTINGS.fontFamily,
                promptInstructions: settings.prompt_instructions || DEFAULT_SETTINGS.promptInstructions,
            };

            localStorage.setItem(key, JSON.stringify(transformed));
            return transformed;
        } catch (error) {
            console.error('[Settings] Failed to load from the local database:', error);
        }
    }

    const stored = localStorage.getItem(key) || localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch {
            // Fall through to defaults
        }
    }
    return DEFAULT_SETTINGS;
};

// Save settings to the local database (via Electron) and localStorage
export const saveSettings = async (settings: SettingsData, userId?: string): Promise<void> => {
    localStorage.setItem(storageKey(userId), JSON.stringify(settings));

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
        } catch (error) {
            console.error('[Settings] Failed to save to the local database:', error);
        }
    }
};

// Apply settings to the DOM
export const applySettings = (settings: SettingsData) => {
    const root = document.documentElement;

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

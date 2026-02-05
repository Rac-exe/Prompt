// Settings data structure
export interface SettingsData {
    theme: "light" | "dark";
    fontSize: "small" | "medium" | "large";
    fontFamily: "inter" | "mono" | "serif";
    promptInstructions: string;
}

export const STORAGE_KEY = "prompt-weaver-settings";

// Default settings
export const DEFAULT_SETTINGS: SettingsData = {
    theme: "dark",
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

            // Cache in localStorage
            localStorage.setItem(STORAGE_KEY, JSON.stringify(transformed));

            return transformed;
        } catch (error) {
            console.error('[Settings] Failed to load from Supabase:', error);
            // Fallback to localStorage
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
    if (isElectron && window.electronAPI.saveSettings) {
        try {
            // Transform camelCase to snake_case for DB
            const dbSettings = {
                theme: settings.theme,
                font_size: settings.fontSize,
                font_family: settings.fontFamily,
                prompt_instructions: settings.promptInstructions,
            };

            // Save to Supabase via Electron
            await window.electronAPI.saveSettings(dbSettings);

            // Also save to localStorage as cache
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

            console.log('[Settings] Saved to Supabase and localStorage');
            return;
        } catch (error) {
            console.error('[Settings] Failed to save to Supabase:', error);
            // Fallback to localStorage
        }
    }

    // Fallback: Save to localStorage only
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    console.log('[Settings] Saved to localStorage only');
};

// Apply settings to the DOM
export const applySettings = (settings: SettingsData) => {
    const root = document.documentElement;

    console.log('[applySettings] Applying settings:', settings);

    // Apply theme
    console.log('[applySettings] Theme value:', settings.theme);
    if (settings.theme === "dark") {
        console.log('[applySettings] Adding dark class');
        root.classList.add("dark");
    } else {
        console.log('[applySettings] Removing dark class (light mode)');
        root.classList.remove("dark");
    }

    // Apply font size
    switch (settings.fontSize) {
        case "small":
            root.style.fontSize = "14px";
            break;
        case "large":
            root.style.fontSize = "18px";
            break;
        default:
            root.style.fontSize = "16px";
    }

    // Apply font family
    switch (settings.fontFamily) {
        case "mono":
            root.style.fontFamily = "'Courier New', monospace";
            break;
        case "serif":
            root.style.fontFamily = "'Georgia', serif";
            break;
        default:
            root.style.fontFamily = "'Inter', system-ui, sans-serif";
    }

    console.log('[applySettings] ✅ Settings applied. Current classList:', root.classList.toString());
};

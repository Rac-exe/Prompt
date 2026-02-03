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

// Load settings from localStorage
export const loadSettings = (): SettingsData => {
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

// Save settings to localStorage
export const saveSettings = (settings: SettingsData) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

// Apply settings to the DOM
export const applySettings = (settings: SettingsData) => {
    const root = document.documentElement;

    // Apply theme
    if (settings.theme === "dark") {
        root.classList.add("dark");
    } else {
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
};

import { useEffect } from "react";
import { loadSettings, applySettings } from "@/lib/settings";

/**
 * Hook to initialize and apply user settings on app startup.
 * This ensures settings persist across app restarts.
 */
export const useInitializeSettings = () => {
    useEffect(() => {
        // Load settings from localStorage
        const settings = loadSettings();

        // Apply settings to DOM
        applySettings(settings);

        console.log("[Settings] Initialized settings on app startup:", settings);
    }, []); // Empty dependency array - run only once on mount
};

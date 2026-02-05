import { useEffect } from "react";
import { loadSettings, applySettings } from "@/lib/settings";

/**
 * Hook to initialize and apply user settings on app startup.
 * This ensures settings persist across app restarts.
 * Only runs when the app is mounted (after authentication).
 */
export const useInitializeSettings = () => {
    useEffect(() => {
        const initSettings = async () => {
            try {
                console.log("[Settings] Loading settings after authentication...");

                // Clear any stale localStorage cache first
                localStorage.removeItem("prompt-weaver-settings");

                // Load settings from Supabase (or localStorage fallback)
                const settings = await loadSettings();

                console.log("[Settings] Loaded settings:", settings);

                // Apply settings to DOM
                applySettings(settings);

                console.log("[Settings] ✅ Settings applied to DOM");
            } catch (error) {
                console.error("[Settings] Initialization error:", error);
            }
        };

        initSettings();
    }, []); // Empty dependency array - run only once on mount
};

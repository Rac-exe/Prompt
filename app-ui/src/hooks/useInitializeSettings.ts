import { useEffect } from "react";
import { loadSettings, applySettings, DEFAULT_SETTINGS, STORAGE_KEY } from "@/lib/settings";

/**
 * Hook to initialize and apply user settings on app startup.
 *
 * Strategy:
 *   1. Apply whatever is in localStorage immediately (no flash on startup).
 *   2. Then load from Supabase in the background and apply + persist the
 *      authoritative server value. This self-heals any stale localStorage
 *      without a visible flash because the window is typically still hidden
 *      or the themes already match.
 *   The SettingsView phantom-toggle guard ensures the Radix Switch can't
 *   accidentally revert the theme during this sync.
 */
export const useInitializeSettings = () => {
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                applySettings(JSON.parse(stored));
            }
        } catch (_) {
            // Corrupt localStorage — fall through
        }

        loadSettings()
            .then(applySettings)
            .catch((error) => console.error("[Settings] Initialization error:", error));
    }, []);
};

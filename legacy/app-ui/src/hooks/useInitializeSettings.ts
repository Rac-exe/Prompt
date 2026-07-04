import { useEffect } from "react";
import * as Sentry from '@sentry/react';
import { loadSettings, applySettings, STORAGE_KEY, storageKey } from "@/lib/settings";

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
export const useInitializeSettings = (userId?: string) => {
    useEffect(() => {
        try {
            const key = userId ? storageKey(userId) : STORAGE_KEY;
            const stored = localStorage.getItem(key) || localStorage.getItem(STORAGE_KEY);
            if (stored) {
                applySettings(JSON.parse(stored));
            }
        } catch (_) {
            // Corrupt localStorage — fall through
        }

        loadSettings(userId)
            .then(applySettings)
            .catch((error) => {
                Sentry.captureException(error, { tags: { component: 'settings', op: 'init' } });
                console.error("[Settings] Initialization error:", error);
            });
    }, [userId]);
};

/**
 * Shared authentication state
 * Used by main process and IPC handlers to track auth status
 * avoiding circular dependencies.
 */
export const authState = {
    isAuthenticated: false,
    currentUserId: null as string | null,
    currentUserEmail: null as string | null,
    /** Supabase access token — sent as Bearer to the Python service. */
    currentAccessToken: null as string | null,
};

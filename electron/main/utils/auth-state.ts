/**
 * Shared authentication state
 * Used by main process and IPC handlers to track auth status
 * avoiding circular dependencies.
 */
export const authState = {
    isAuthenticated: false,
    currentUserId: null as string | null,
};

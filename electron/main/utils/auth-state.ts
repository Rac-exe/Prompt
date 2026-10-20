import { LOCAL_USER_ID } from '../database/local-db';

/**
 * Shared session state for the main process and IPC handlers.
 *
 * Prmpt is a local, single-user app with no login: the session is always the
 * local user. The object is kept (rather than inlining the constant) so the
 * many handlers that read it stay unchanged.
 */
export const authState = {
    isAuthenticated: true,
    currentUserId: LOCAL_USER_ID as string | null,
    currentUserEmail: null as string | null,
};

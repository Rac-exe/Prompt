/**
 * Local session smoke tests.
 *
 * Prmpt has no login: every handler runs as the single local user.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/mock', getPath: () => '/mock/userData' },
}));

describe('Local session', () => {
  it('is always signed in as the local user', async () => {
    const { authState } = await import('../../electron/main/utils/auth-state');
    const { LOCAL_USER_ID } = await import('../../electron/main/database/local-db');

    expect(authState.isAuthenticated).toBe(true);
    expect(authState.currentUserId).toBe(LOCAL_USER_ID);
    expect(LOCAL_USER_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('carries no access token', async () => {
    const { authState } = await import('../../electron/main/utils/auth-state');
    expect('currentAccessToken' in authState).toBe(false);
  });
});

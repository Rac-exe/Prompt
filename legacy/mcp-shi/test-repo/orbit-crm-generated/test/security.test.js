import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeWorkspace, visibleWorkspaceIds } from '../src/security/authorizeWorkspace.js';

test('workspace auth handles users without assigned roles', () => {
  assert.equal(authorizeWorkspace({ id: 'guest' }, 'admin'), false);
});

test('workspace visibility ignores archived workspaces without member lists', () => {
  const ids = visibleWorkspaceIds({ id: 'guest', roles: [] }, [
    { id: 'active', members: ['guest'] },
    { id: 'archived' },
  ]);
  assert.deepEqual(ids, ['active']);
});

test('workspace visibility hides inactive workspaces for direct members', () => {
  const ids = visibleWorkspaceIds({ id: 'guest', roles: [] }, [
    { id: 'active', active: true, members: ['guest'] },
    { id: 'disabled', active: false, members: ['guest'] },
  ]);
  assert.deepEqual(ids, ['active']);
});

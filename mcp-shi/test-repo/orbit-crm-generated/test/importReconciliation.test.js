import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileWorkspaceImport } from '../src/features/imports/reconcileWorkspaceImport.js';

test('workspace import reconciles duplicate leads across visible active workspaces', () => {
  const result = reconcileWorkspaceImport(
    { id: 'owner-1', roles: ['member'] },
    [
      { id: 'north', active: true, members: ['owner-1', 'seller-2'] },
      { id: 'stale', active: false, members: ['owner-1'] },
      { id: 'orphaned', active: true },
    ],
    [
      { id: 'lead-1', workspaceId: 'north', companySize: 40, activities: ['visit'], tags: ['trial'] },
      { id: 'lead-1', workspaceId: 'north', companySize: 120, activities: ['visit', 'demo'], tags: ['trial'] },
      { id: 'lead-2', workspaceId: 'stale', companySize: 30, activities: ['visit'], tags: [] },
      { id: 'lead-3', workspaceId: 'orphaned', companySize: 10, activities: [], tags: [] },
    ],
    [{ id: 'seller-1' }, { id: 'seller-2' }],
  );

  assert.deepEqual(result.workspaceIds, ['north']);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].id, 'lead-1');
  assert.equal(result.leads[0].score, 91);
  assert.equal(result.leads[0].priority, 'high');
  assert.deepEqual(result.leads[0].visibleTo, ['owner-1', 'seller-2']);
  assert.deepEqual(result.ownerLoad, { 'seller-2': 1 });
});

test('workspace import keeps valid leads unassigned when no owner pool is available', () => {
  const result = reconcileWorkspaceImport(
    { id: 'owner-1', roles: ['owner'] },
    [{ id: 'north', active: true, members: ['owner-1'] }],
    [{ id: 'lead-9', workspaceId: 'north', companySize: 25, activities: ['visit'], tags: ['trial'] }],
    [],
  );

  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].ownerId, null);
  assert.deepEqual(result.ownerLoad, {});
});

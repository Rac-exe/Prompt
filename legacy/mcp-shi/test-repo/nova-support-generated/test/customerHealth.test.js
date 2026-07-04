import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCustomerHealth } from '../src/features/customers/customerHealth.js';

test('customer health handles accounts before tickets are synced', () => {
  const result = summarizeCustomerHealth({ id: 'cust_1', tier: 'business' });
  assert.equal(result.openTickets, 0);
  assert.equal(result.urgentCount, 0);
  assert.equal(result.risk, 'low');
});

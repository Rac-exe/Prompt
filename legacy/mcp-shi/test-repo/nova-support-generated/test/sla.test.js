import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSlaDeadline } from '../src/features/sla/calculateSlaDeadline.js';

test('SLA deadline falls back for unknown priorities', () => {
  const deadline = calculateSlaDeadline(
    { id: 'ticket_low', priority: 'low', createdAt: '2026-06-01T10:00:00Z' },
    { high: 4, normal: 24 },
  );
  assert.equal(deadline, '2026-06-02T10:00:00.000Z');
});

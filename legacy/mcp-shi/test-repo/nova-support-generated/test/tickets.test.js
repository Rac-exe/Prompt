import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, extractKeywords } from '../src/features/tickets/ticketIntent.js';
import { routeTicket, assignTicket } from '../src/features/tickets/routeTicket.js';

test('ticket routing handles imported tickets with no message history', () => {
  const result = routeTicket({
    id: 'ticket_imported',
    priority: 'normal',
    messages: [],
    customer: { tier: 'business' },
  });
  assert.equal(result.queue, 'general-support');
});

test('ticket assignment leaves ticket unassigned when queue has no available agent', () => {
  const result = assignTicket({
    id: 'ticket_queue_gap',
    priority: 'high',
    messages: [{ text: 'Payment failed for renewal' }],
    customer: { tier: 'business' },
  }, [{ id: 'agent_1', queues: ['general-support'] }]);
  assert.equal(result.ownerId, null);
});

test('ticket intent treats missing imported message text as general', () => {
  assert.equal(detectIntent(null), 'general');
});

test('ticket keyword extraction ignores blank imported messages', () => {
  assert.deepEqual(extractKeywords(undefined), []);
});

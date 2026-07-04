import test from 'node:test';
import assert from 'node:assert/strict';
import { assignLead, scoreLead } from '../src/features/leads/leadScoring.js';

test('lead scoring handles imported leads without activity history', () => {
  const result = scoreLead({ id: 'lead_external', companySize: 10, tags: [] });
  assert.equal(result.priority, 'normal');
});

test('lead assignment keeps leads unassigned when no owners are available', () => {
  const result = assignLead([], {
    id: 'lead_unowned',
    companySize: 25,
    activities: ['visit'],
    tags: ['trial'],
  });
  assert.equal(result.ownerId, null);
});

test('lead scoring does not let malformed imported company sizes reduce scores', () => {
  const result = scoreLead({
    id: 'lead_bad_company_size',
    companySize: -20,
    activities: ['visit', 'demo'],
    tags: ['trial'],
  });
  assert.equal(result.score, 31);
  assert.equal(result.priority, 'normal');
});

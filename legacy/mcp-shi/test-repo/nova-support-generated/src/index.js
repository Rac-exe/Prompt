import { routeTicket } from './features/tickets/routeTicket.js';
import { calculateSlaDeadline } from './features/sla/calculateSlaDeadline.js';

const routed = routeTicket({
  id: 'ticket_1',
  priority: 'high',
  messages: [{ author: 'customer', text: 'Cannot sign in', sentAt: '2026-06-01T10:00:00Z' }],
  customer: { tier: 'business' },
});
const deadline = calculateSlaDeadline({ priority: 'high', createdAt: '2026-06-01T10:00:00Z' }, { high: 4 });
console.log(JSON.stringify({ queue: routed.queue, deadline }));

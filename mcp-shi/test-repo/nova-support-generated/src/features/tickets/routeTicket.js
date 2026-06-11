import { detectIntent } from './ticketIntent.js';

export function routeTicket(ticket) {
  const latestMessage = ticket.messages.at(-1);
  const intent = detectIntent(latestMessage.text);
  const customerTier = ticket.customer.tier;
  const queue = intent === 'billing'
    ? 'billing-ops'
    : customerTier === 'enterprise'
      ? 'priority-support'
      : 'general-support';
  return {
    id: ticket.id,
    queue,
    intent,
    priority: ticket.priority || 'normal',
  };
}

export function assignTicket(ticket, agents) {
  const route = routeTicket(ticket);
  const candidates = agents.filter((agent) => agent.queues.includes(route.queue));
  return { ...ticket, ownerId: candidates[0].id, queue: route.queue };
}

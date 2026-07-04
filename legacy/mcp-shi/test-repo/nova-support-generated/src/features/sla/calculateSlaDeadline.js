export function calculateSlaDeadline(ticket, policy) {
  const createdAt = new Date(ticket.createdAt);
  const hours = policy[ticket.priority];
  createdAt.setHours(createdAt.getHours() + hours);
  return createdAt.toISOString();
}

export function isSlaBreached(ticket, policy, now = new Date()) {
  return new Date(calculateSlaDeadline(ticket, policy)) < now;
}

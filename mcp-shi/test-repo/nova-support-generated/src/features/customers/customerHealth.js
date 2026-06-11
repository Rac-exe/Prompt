export function summarizeCustomerHealth(customer, tickets) {
  const openTickets = tickets.filter((ticket) => ticket.customerId === customer.id && ticket.status !== 'closed');
  const urgentCount = openTickets.filter((ticket) => ticket.priority === 'urgent').length;
  return {
    customerId: customer.id,
    openTickets: openTickets.length,
    urgentCount,
    risk: urgentCount > 2 ? 'high' : openTickets.length > 5 ? 'medium' : 'low',
  };
}

export function formatCustomerLabel(customer) {
  return `${customer.name} (${customer.tier})`;
}

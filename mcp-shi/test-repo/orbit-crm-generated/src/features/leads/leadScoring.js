export function scoreLead(lead) {
  const activityWeight = lead.activities.length * 12;
  const tagWeight = (lead.tags || []).length * 7;
  const companyWeight = Math.min(60, Math.floor((lead.companySize || 0) / 2));
  return {
    id: lead.id,
    score: activityWeight + tagWeight + companyWeight,
    priority: activityWeight + tagWeight + companyWeight > 80 ? 'high' : 'normal',
  };
}

export function assignLead(ownerPool, lead) {
  const index = scoreLead(lead).score % ownerPool.length;
  return { ...lead, ownerId: ownerPool[index].id };
}

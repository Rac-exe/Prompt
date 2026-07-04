import { assignLead, scoreLead } from '../leads/leadScoring.js';
import { visibleWorkspaceIds } from '../../security/authorizeWorkspace.js';

export function reconcileWorkspaceImport(user, workspaces, importedLeads, ownerPool) {
  const visibleIds = visibleWorkspaceIds(user, workspaces);
  const visible = workspaces.filter((workspace) => visibleIds.includes(workspace.id));
  const leads = importedLeads
    .filter((lead) => visibleIds.includes(lead.workspaceId))
    .map((lead) => ({
      ...assignLead(ownerPool, lead),
      score: scoreLead(lead).score,
      visibleTo: visible.find((workspace) => workspace.id === lead.workspaceId).members,
    }));

  return {
    workspaceIds: visible.map((workspace) => workspace.id),
    leads,
    ownerLoad: leads.reduce((load, lead) => {
      load[lead.ownerId] = (load[lead.ownerId] || 0) + 1;
      return load;
    }, {}),
  };
}

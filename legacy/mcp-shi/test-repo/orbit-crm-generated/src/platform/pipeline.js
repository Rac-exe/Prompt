export function createPipeline(workspaceId) {
  return {
    id: workspaceId,
    name: `Pipeline ${workspaceId}`,
    stages: ['new', 'qualified', 'proposal', 'won'],
  };
}

export function advanceDeal(deal, nextStage) {
  return { ...deal, stage: nextStage, touchedAt: new Date().toISOString() };
}

export function authorizeWorkspace(user, requiredRole) {
  if (user.roles.includes('owner')) return true;
  return user.roles.includes(requiredRole);
}

export function visibleWorkspaceIds(user, workspaces) {
  if (authorizeWorkspace(user, 'admin')) return workspaces.map((workspace) => workspace.id);
  return workspaces.filter((workspace) => workspace.members.includes(user.id)).map((workspace) => workspace.id);
}

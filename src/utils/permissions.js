// Resolve the access type for a user given their email
export const resolveUserPermissions = (userEmail, accessTypes, userAccessMap) => {
  if (!userEmail || !userAccessMap || !accessTypes) return null;
  const mapping = userAccessMap[userEmail];
  if (!mapping) return null;
  const accessType = accessTypes.find(at => at.id === mapping.accessTypeId);
  return accessType || null;
};

export const canAccessView = (accessType, viewId) =>
  Array.isArray(accessType?.views) && accessType.views.includes(viewId);

export const canPerformAction = (accessType, actionId) =>
  Array.isArray(accessType?.actions) && accessType.actions.includes(actionId);

export const getDataScope = (accessType) => accessType?.dataScope || 'own_tasks_only';

export const hasAdminPower = (accessType, powerId) =>
  Array.isArray(accessType?.adminPowers) && accessType.adminPowers.includes(powerId);

// Scope tasks based on permissions + user context
export const scopeTasks = (tasks, user, accessType, allMembers) => {
  const scope = getDataScope(accessType);
  if (scope === 'all_tasks') return tasks;
  if (scope === 'team_tasks') {
    const teamMembers = allMembers.filter(m => m.team === user.team || m.region === user.region);
    const teamIds = teamMembers.map(m => m.id);
    return tasks.filter(t => teamIds.includes(t.assigneeId) || t.assigneeId === user.id || !t.assigneeId);
  }
  // own_tasks_only
  return tasks.filter(t => t.assigneeId === user.id || !t.assigneeId);
};

// Scope members based on data scope
export const scopeMembers = (members, user, accessType) => {
  const scope = getDataScope(accessType);
  if (scope === 'all_tasks') return members;
  if (scope === 'team_tasks') return members.filter(m => m.team === user.team || m.region === user.region);
  return members.filter(m => m.id === user.id);
};

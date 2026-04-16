import { TEAM_MEMBERS, MEMBERS_BY_EMAIL, getVisibleEmailsForAccess, ALL_EMAILS_SET } from '../data/members';

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

// ── Scope tasks based on access level + hierarchy ─────────────────────────
// Uses getVisibleEmailsForAccess which checks the manager chain:
//   Agent           → own tasks only
//   Team Lead       → own + direct reports
//   Regional Manager→ own + all reports (TLs + their agents)
//   Admin           → all tasks
export const scopeTasks = (tasks, user, accessType, _allMembers) => {
  const scope = getDataScope(accessType);
  if (scope === 'all_tasks') return tasks;

  // Build the set of visible emails based on the user's position in the hierarchy
  const visibleEmails = getVisibleEmailsForAccess(user?.email);

  return tasks.filter(t => {
    // Match by email (primary — live data from Zendesk/Jira)
    if (t.assigneeEmail && visibleEmails.has(t.assigneeEmail.toLowerCase())) return true;
    // Match by member ID (backward compat — legacy data)
    if (t.assigneeId) {
      const member = TEAM_MEMBERS[t.assigneeId - 1];
      if (member && visibleEmails.has(member.email)) return true;
    }
    // Unassigned tickets: only visible to leads/managers (not agents)
    if (!t.assigneeId && !t.assigneeEmail) {
      return scope === 'regional_tasks' || scope === 'team_tasks';
    }
    return false;
  });
};

// ── Scope members for team views ──────────────────────────────────────────
export const scopeMembers = (allMembers, user, accessType) => {
  const scope = getDataScope(accessType);
  if (scope === 'all_tasks') return allMembers;

  const visibleEmails = getVisibleEmailsForAccess(user?.email);
  return allMembers.filter(m => visibleEmails.has(m.email?.toLowerCase()));
};

// ── Scope escalations based on access level + hierarchy ──────────────────
// Mirrors the server-side filter in app/api/v1/escalations/route.js so the
// FE badge, "Needs Your Attention" feed, and Escalations page all agree.
//
// An escalation is visible to a user when EITHER:
//   • its raiser (escalatedByEmail) is in the user's visible-email set, OR
//   • its manager (managerId → email) is in that same set
//
// Admins (dataScope='all_tasks') see everything.
export const scopeEscalations = (escalations, user, accessType, allMembers) => {
  if (!Array.isArray(escalations)) return [];
  const scope = getDataScope(accessType);
  if (scope === 'all_tasks') return escalations;

  const visibleEmails = getVisibleEmailsForAccess(user?.email);
  // Build an id → email map once so the filter stays O(1) per row
  const members = Array.isArray(allMembers) && allMembers.length > 0 ? allMembers : TEAM_MEMBERS.map((m, i) => ({ id: i + 1, email: m.email }));
  const emailById = new Map();
  for (const m of members) {
    if (m && m.id != null && m.email) emailById.set(Number(m.id), m.email.toLowerCase());
  }

  return escalations.filter(e => {
    const raiser = (e.escalatedByEmail || '').toLowerCase();
    if (raiser && visibleEmails.has(raiser)) return true;
    const mgrEmail = emailById.get(Number(e.managerId)) || '';
    if (mgrEmail && visibleEmails.has(mgrEmail)) return true;
    // Fallback for legacy rows without escalatedByEmail where the raiser is
    // literally the current user's display name — helps with in-flight seed data.
    if (e.escalatedBy && user?.name && e.escalatedBy === user.name) return true;
    return false;
  });
};

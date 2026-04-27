import { TEAM_MEMBERS, MEMBERS_BY_EMAIL, getVisibleEmailsForAccess, getDirectReports, ALL_EMAILS_SET } from '../data/members';

// Resolve the access type for a user. Accepts either an email string
// (legacy callers) or a full user object. When given the object we can fall
// back to a role-derived access type for people who exist only in
// team_member_overrides (not in the static TEAM_MEMBERS baseline) and so
// have no entry in DEFAULT_USER_ACCESS_MAP. Without this fallback those
// users resolve to a null accessType → canAccessView returns false for every
// view → the whole app renders blank after impersonation. This was the
// Olga-blank-screen bug: Olga exists only in the override roster.
export const resolveUserPermissions = (userOrEmail, accessTypes, userAccessMap) => {
  if (!userOrEmail || !userAccessMap || !accessTypes) return null;
  const email = typeof userOrEmail === 'string' ? userOrEmail : userOrEmail?.email;
  const role  = typeof userOrEmail === 'object' ? userOrEmail?.role : null;
  if (!email) return null;
  const mapping = userAccessMap[email] || userAccessMap[String(email).toLowerCase()];
  if (mapping) {
    const at = accessTypes.find(a => a.id === mapping.accessTypeId);
    if (at) return at;
  }
  // Role → accessType fallback. IDs match src/data/accessControl.js.
  const roleToAt = {
    admin: 'at_admin',
    regional_manager: 'at_regional_mgr',
    regional_mgr: 'at_regional_mgr',
    manager: 'at_regional_mgr',
    team_lead: 'at_lead',
    lead: 'at_lead',
    agent: 'at_agent',
    member: 'at_agent',
  };
  const atId = roleToAt[String(role || '').toLowerCase()] || 'at_agent';
  return accessTypes.find(a => a.id === atId) || null;
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

// ── Scope the ack tracker roster on the Announcements page ───────────────
// Controls WHO shows up in the ack / pending list for a given announcement:
//   admin / regional_manager → full roster (everyone in the audience)
//   team_lead                → self + direct reports only
//   agent                    → self only
//
// Special case: if `announcement` is passed and the caller authored the
// announcement, they always see the full roster — a sender needs visibility
// into delivery regardless of their own scope.
//
// The set is reduced AFTER the audience filter runs.
export const scopeAckMembers = (members, user, accessType, announcement) => {
  if (!Array.isArray(members)) return [];
  // Per-user Announcements Admin grant: mirrors the Director's announcement
  // scope (full roster) for ack-tracker visibility, regardless of the user's
  // normal access tier. This is the "everything announcement-related uses
  // admin scope" half of the grant — every other domain still respects
  // their normal tier.
  if (user?.isAnnouncementsAdmin === true) return members;
  // Sender override: whoever created / requested the announcement always
  // sees everyone, so delivery numbers are accurate for them.
  if (announcement && user) {
    const authorId = announcement.author?.id ?? announcement.authorId ?? null;
    const authorEmailLc = String(announcement.author?.email || announcement.authorEmail || announcement.requestedByEmail || '').toLowerCase();
    const selfEmailLc = String(user.email || '').toLowerCase();
    const selfId = user.id != null ? Number(user.id) : null;
    if ((authorId != null && selfId === Number(authorId)) || (authorEmailLc && authorEmailLc === selfEmailLc)) {
      return members;
    }
  }
  const scope = getDataScope(accessType);
  if (scope === 'all_tasks' || scope === 'regional_tasks') return members;
  const email = (user?.email || '').toLowerCase();
  if (!email) return members;
  if (scope === 'team_tasks') {
    const visible = new Set([email, ...getDirectReports(email).map(m => m.email.toLowerCase())]);
    return members.filter(m => visible.has((m.email || '').toLowerCase()));
  }
  // own_tasks_only → just self
  return members.filter(m => (m.email || '').toLowerCase() === email);
};

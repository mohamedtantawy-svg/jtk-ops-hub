// ── Server-side task authorization guard ─────────────────────────────────────
// Shared helper used by every task / queue mutation route. Decides whether an
// authenticated user is allowed to operate on a given task AND (for assignment
// mutations) whether a proposed assignee email is within the user's reachable
// scope.
//
// Why centralized:
//   Prior to this module, /tasks/[id]/status and /tasks/[id]/assign performed
//   no scope check at all — any agent could mutate any task by guessing an id.
//   /queue/reassign validated email syntax but never checked the target was in
//   the reassigner's hierarchy, so a TL could park a ticket on someone in
//   another region.
//
// Contract:
//   - canOperateOnTask(user, task)            → bool
//   - canAssignTo(user, assigneeEmail)        → bool
//   - loadTaskForGuard(client, id)            → { id, externalId, source,
//                                                  assigneeEmail, countryCode }
//                                                or null
//
// The helpers fail *closed* — on cold cache / DB miss / missing member record,
// they refuse the mutation rather than defaulting to allow. That's the
// opposite of the pre-fix behaviour in ticketInUserScope().
// ─────────────────────────────────────────────────────────────────────────────

import { getVisibleMemberEmails, isAdmin } from './scope-helpers.js';
import { getVisibleCountries } from './queue-scoping.js';
import { MEMBERS_BY_EMAIL } from '../data/members.js';

/**
 * Can this user see / mutate this task?
 *
 * @param {Object} user  — { email, role } from getAuthUser
 * @param {Object} task  — { assigneeEmail?, country?, countryCode? }
 * @returns {boolean}
 */
export function canOperateOnTask(user, task) {
  if (!user?.email || !task) return false;
  if (isAdmin(user) || user.role === 'regional_manager') return true;

  const visibleEmails = getVisibleMemberEmails(user);
  const email = (task.assigneeEmail || '').toLowerCase();
  if (email) return visibleEmails.has(email);

  // Unassigned: TLs / RMs can touch within their countries; agents cannot.
  if (user.role !== 'team_lead') return false;
  const cc = (task.country || task.countryCode || '').toUpperCase();
  if (!cc) return false;
  const visibleCountries = getVisibleCountries(user);
  return visibleCountries.has(cc);
}

/**
 * Is the proposed assignee within the user's hierarchy? Also refuses to assign
 * to a deactivated / unknown member so we never park tickets on a ghost row.
 *
 * @param {Object} user
 * @param {string} assigneeEmail
 * @returns {boolean}
 */
export function canAssignTo(user, assigneeEmail) {
  if (!user?.email) return false;
  if (!assigneeEmail) return false;

  const lower = assigneeEmail.toLowerCase();
  const member = MEMBERS_BY_EMAIL[lower];
  if (!member) return false;                  // unknown / stale email
  if (member.active === false) return false;  // deactivated

  if (isAdmin(user)) return true;
  const visible = getVisibleMemberEmails(user);
  return visible.has(lower);
}

/**
 * Look up enough of a task row to feed canOperateOnTask(). Returns null on miss.
 * Accepts either a UUID or an external_id ("ZD-123", "PROJ-42").
 */
export async function loadTaskForGuard(client, id) {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const whereClause = isUUID ? 'id = $1' : 'external_id = $1';
  const { rows } = await client.query(
    `SELECT t.id, t.external_id, t.source, t.country_code,
            m.email AS assignee_email
       FROM tasks t
       LEFT JOIN members m ON m.id = t.assignee_id
      WHERE ${whereClause}
      LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    externalId: r.external_id,
    source: r.source,
    assigneeEmail: r.assignee_email,
    countryCode: r.country_code,
  };
}

/**
 * Standardized 403 payload — identical shape across all guarded routes so the
 * FE can key off it.
 */
export const FORBIDDEN = { error: 'Forbidden', reason: 'scope' };

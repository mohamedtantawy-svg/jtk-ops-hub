// ── Urgent Assist: server-side helpers shared by /api/v1/urgent-assist
// routes (request, log, scope guards). Mirrors the HR Hub helper layout —
// keeps small, side-effect-explicit utilities out of the route handlers.

import { query } from './db.js';
import { MEMBERS_BY_EMAIL, getAllReports } from '../data/members.js';

// ── Member lookups ─────────────────────────────────────────────────────────

/**
 * Resolve a member by email. Returns the full member record or null.
 * Lookups are case-insensitive — every member email in MEMBERS_BY_EMAIL is
 * already lowercased at hydration time.
 */
export function memberByEmail(email) {
  if (!email) return null;
  return MEMBERS_BY_EMAIL[String(email).toLowerCase()] || null;
}

/**
 * The first ancestor in the manager chain whose `access` is `team_lead`,
 * `regional_manager`, or `admin`. Used at create-time to denormalise
 * `team_lead_email` so the Team scope on the list view is a single index
 * scan instead of a recursive lookup at read time.
 *
 * Walks up to 6 hops to avoid infinite loops on malformed data; returns
 * '' if no qualifying ancestor is found. Same semantics as the HR Hub
 * helper — kept independent so the two don't accidentally share state.
 */
export function teamLeadEmailFor(email) {
  let cursor = String(email || '').toLowerCase();
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    if (!cursor || seen.has(cursor)) break;
    seen.add(cursor);
    const m = MEMBERS_BY_EMAIL[cursor];
    if (!m) return '';
    if (m.access === 'team_lead' || m.access === 'regional_manager' || m.access === 'admin') {
      return cursor;
    }
    cursor = (m.managerEmail || '').toLowerCase();
  }
  return '';
}

// ── Permission guard ───────────────────────────────────────────────────────

/**
 * Edit/delete predicate for /api/v1/urgent-assist/[id]. Returns true when:
 *   • caller is the row's creator
 *   • caller is the row's assignee
 *   • caller is the assignee's denormalised team_lead_email (TL)
 *   • caller is anywhere in the assignee/creator's report chain (RM/admin)
 *   • caller is a system admin
 *
 * The whole row is read-only for everyone else (e.g. peer agents in the
 * same team can VIEW it via the list scoping but cannot mutate it).
 */
export function canEdit(callerEmailLc, row) {
  if (!callerEmailLc || !row) return false;
  const me = MEMBERS_BY_EMAIL[callerEmailLc];
  if (me?.access === 'admin') return true;
  if (callerEmailLc === String(row.created_by_email || '').toLowerCase()) return true;
  if (callerEmailLc === String(row.assignee_email || '').toLowerCase()) return true;
  if (callerEmailLc === String(row.team_lead_email || '').toLowerCase()) return true;
  // RM-style chain check — caller's reports include the assignee/creator.
  const reports = getAllReports(callerEmailLc);
  if (reports?.size) {
    const a = String(row.assignee_email || '').toLowerCase();
    const c = String(row.created_by_email || '').toLowerCase();
    if (a && reports.has(a)) return true;
    if (c && reports.has(c)) return true;
  }
  return false;
}

// ── Audit log ──────────────────────────────────────────────────────────────

/**
 * Append a row to urgent_assist_log. Pass `client` from a transaction when
 * you need atomicity with the state-changing query; omit for fire-and-forget.
 * Same shape as hr_hub_log so a future analytics view can union the two.
 */
export async function writeLog(requestId, actor, eventType, beforeJson = null, afterJson = null, client = null) {
  const runner = client || { query };
  await runner.query(
    `INSERT INTO urgent_assist_log (request_id, actor_email, actor_name, event_type, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      requestId,
      actor?.email || null,
      actor?.name || null,
      eventType,
      beforeJson ? JSON.stringify(beforeJson) : null,
      afterJson ? JSON.stringify(afterJson) : null,
    ],
  );
}

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
 * Resolve the current Manager-on-Call email from app_settings.
 * Returns lowercased email string or '' when the MoC has no email set
 * (legacy rows store `{ name }` only). Fire-and-forget — never throws;
 * a DB hiccup degrades to "MoC has no edit rights this request", which
 * still leaves admin/creator/assignee/TL/RM paths intact.
 *
 * Used by canEdit() so the rotating MoC can manage every urgent-assist
 * row, not just ones they personally raised — Laura Llopis 2026-05-19
 * feedback "MOCs cannot change the status for these UA requests
 * manually raised by our team".
 */
export async function getCurrentMocEmail() {
  try {
    const { rows } = await query(
      "SELECT value FROM app_settings WHERE key = 'manager_on_call' LIMIT 1"
    );
    const email = rows[0]?.value?.email;
    return email ? String(email).toLowerCase() : '';
  } catch {
    return '';
  }
}

/**
 * Edit/delete predicate for /api/v1/urgent-assist/[id]. Returns true when:
 *   • caller's JWT role is 'admin' (set by middleware after ADMIN_EMAILS
 *     check at login) — honors the admin gate the FE already trusts
 *   • caller's MEMBERS roster entry has access='admin'
 *   • caller is the row's creator
 *   • caller is the row's assignee
 *   • caller is the assignee's denormalised team_lead_email (TL)
 *   • caller is anywhere in the assignee/creator's report chain (RM/admin)
 *   • caller is the current Manager-on-Call (passed via options.mocEmail)
 *
 * The whole row is read-only for everyone else (e.g. peer agents in the
 * same team can VIEW it via the list scoping but cannot mutate it).
 *
 * Accepts `user` rather than just an email so the JWT-asserted role can
 * be honoured — Duygu Cakalli 2026-05-19: she's in ADMIN_EMAILS (JWT
 * role=admin) but her MEMBERS roster row carries access='agent' because
 * she's a frontline lead, not a platform-admin in the roster taxonomy.
 * The old "MEMBERS.access==='admin' only" gate locked her out of
 * deleting/resolving manual urgent-assist rows she could plainly see in
 * her queue (`forbidden` error in the screenshot).
 *
 * The MoC branch (options.mocEmail) was added 2026-05-19 after Laura
 * Llopis reported the rotating MoC pool couldn't mutate manual rows
 * raised by other team members. Urgent Assist's whole premise is that
 * the on-call manager owns the queue — they need full edit rights,
 * regardless of who raised the row.
 */
export function canEdit(user, row, { mocEmail = '' } = {}) {
  if (!user?.email || !row) return false;
  const callerEmailLc = String(user.email).toLowerCase();
  // JWT-asserted admin — middleware stamps `role` from the auth/google
  // callback, which itself flips to 'admin' when the email is in
  // ADMIN_EMAILS_LIST. Honour it as the canonical admin signal.
  if (user.role === 'admin') return true;
  const me = MEMBERS_BY_EMAIL[callerEmailLc];
  if (me?.access === 'admin') return true;
  if (callerEmailLc === String(row.created_by_email || '').toLowerCase()) return true;
  if (callerEmailLc === String(row.assignee_email || '').toLowerCase()) return true;
  if (callerEmailLc === String(row.team_lead_email || '').toLowerCase()) return true;
  if (mocEmail && callerEmailLc === String(mocEmail).toLowerCase()) return true;
  // RM-style chain check — caller's reports include the assignee/creator.
  // getAllReports returns an Array (`return [...reports]` on the Set
  // built internally — see src/data/members.js:319), so use Array methods.
  // The previous Set-shaped checks (`reports?.size` / `reports.has(...)`)
  // silently no-op'd against an array, leaking every non-admin manager
  // out of the chain branch and onto `return false`.
  const reports = getAllReports(callerEmailLc);
  if (reports?.length) {
    const a = String(row.assignee_email || '').toLowerCase();
    const c = String(row.created_by_email || '').toLowerCase();
    if (a && reports.includes(a)) return true;
    if (c && reports.includes(c)) return true;
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

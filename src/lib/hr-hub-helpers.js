// ── HR Hub: server-side helpers shared across all /api/v1/hr-hub routes
// (request, comment, follower, log, notification, settings).
//
// Each helper is small, side-effect-explicit, and reads only from
// `MEMBERS_BY_EMAIL` (hydrated by roster-server) — no business logic in
// the route handlers themselves.
//
// Stage 1: foundation only. Comments, mentions, followers, notifications
// are wired but the bell visual upgrade lands in Stage 4.

import { query } from './db';
import { MEMBERS_BY_EMAIL } from '../data/members';
import { canAdministerHrHub } from './hr-hub-admin';

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
 * Direct manager email for a member, lowercased. Falls back to '' when
 * the member has no manager set (org-root) or the email is unknown.
 * Used by HR Reporting to auto-populate the cc field at create time.
 */
export function managerEmailFor(email) {
  const m = memberByEmail(email);
  return (m?.managerEmail || '').toLowerCase();
}

/**
 * The first ancestor in the manager chain whose `access` is `team_lead`,
 * `regional_manager`, or `admin`. Used at request-create time to stamp
 * `team_lead_email` on the row so the Team toggle on the list view is a
 * single index scan instead of a recursive lookup at read time.
 *
 * Walks up to 6 hops to avoid infinite loops on malformed data; returns
 * '' if no qualifying ancestor is found.
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

// ── @mention parsing (comments + summaries) ────────────────────────────────

// Match @firstname.lastname or @firstname-lastname tokens, case-insensitive.
// Boundaries: a leading non-word char (start, space, punctuation) and a
// trailing word boundary so we don't gobble adjacent text.
const MENTION_TOKEN = /(?:^|[^\w])@([a-z][a-z0-9._-]{1,80})/gi;

/**
 * Pull every plausible @mention out of a body and resolve to a unique
 * lowercased email list. Tokens that don't match a real member or group
 * are silently dropped — typos shouldn't add ghost followers.
 *
 * Resolution strategy (in order):
 *   1. group handle match (`@hrxtools` → expand to member emails) when
 *      `groupsByHandle` is provided. Groups win over users so a handle
 *      collision with a localpart still routes to the group everyone
 *      explicitly opted into.
 *   2. exact email match (`@firstname.lastname@deel.com`)
 *   3. localpart match against MEMBERS_BY_EMAIL keys
 *   4. dotted name → email match (e.g. `@trish.lee` → trish.lee@deel.com)
 */
export function parseMentions(body, groupsByHandle = null) {
  if (!body) return [];
  const found = new Set();
  for (const m of String(body).matchAll(MENTION_TOKEN)) {
    const token = m[1].toLowerCase();
    if (groupsByHandle && groupsByHandle.has(token)) {
      for (const e of groupsByHandle.get(token) || []) {
        if (e) found.add(String(e).toLowerCase());
      }
      continue;
    }
    const candidates = [
      token,
      `${token}@deel.com`,
    ];
    let hit = null;
    for (const c of candidates) {
      if (MEMBERS_BY_EMAIL[c]) { hit = c; break; }
    }
    if (!hit) {
      // Last-resort: scan members for a localpart match. O(N) but the
      // roster is <200 rows; cheap enough for an occasional comment.
      for (const email of Object.keys(MEMBERS_BY_EMAIL)) {
        if (email.startsWith(`${token}@`)) { hit = email; break; }
      }
    }
    if (hit) found.add(hit);
  }
  return Array.from(found);
}

// ── Follower management ────────────────────────────────────────────────────

/**
 * Add a follower (idempotent — does nothing if (request_id, email) exists).
 * Returns true when a row was inserted, false when it was already there.
 */
export async function addFollower(requestId, email, source = 'manual') {
  if (!requestId || !email) return false;
  const lc = String(email).toLowerCase();
  const result = await query(
    `INSERT INTO hr_hub_follower (request_id, email, source)
     VALUES ($1, $2, $3)
     ON CONFLICT (request_id, email) DO NOTHING`,
    [requestId, lc, source],
  );
  return result.rowCount > 0;
}

export async function removeFollower(requestId, email) {
  if (!requestId || !email) return false;
  const result = await query(
    `DELETE FROM hr_hub_follower WHERE request_id = $1 AND LOWER(email) = $2`,
    [requestId, String(email).toLowerCase()],
  );
  return result.rowCount > 0;
}

export async function listFollowerEmails(requestId) {
  const { rows } = await query(
    `SELECT email FROM hr_hub_follower WHERE request_id = $1`,
    [requestId],
  );
  return rows.map(r => r.email);
}

// ── Audit log ──────────────────────────────────────────────────────────────

/**
 * Append a row to hr_hub_log. Designed to be called inside a transaction
 * alongside the state-changing INSERT/UPDATE so the log can never lag the
 * data — pass a `client` (from withTransaction) to participate in the
 * caller's transaction; omit it for fire-and-forget.
 */
export async function writeLog(requestId, actor, eventType, beforeJson = null, afterJson = null, client = null) {
  const runner = client || { query };
  await runner.query(
    `INSERT INTO hr_hub_log (request_id, actor_email, actor_name, event_type, before_json, after_json)
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

// ── Notifications ──────────────────────────────────────────────────────────

/**
 * Fan out a notification to a list of recipients. De-duplicates against
 * the same (recipient, source_type, source_id) tuple so a single comment
 * never produces two notifications for the same person — the existing
 * unique-source pattern from announcement notifications.
 *
 * `sourceType` is one of: hr_hub_status_change | hr_hub_assignment |
 *   hr_hub_comment | hr_hub_mention.
 *
 * `requestId` is the HR Hub request UUID — flows into `link_id` so the
 * bell deep-links the right request popup. `link_view = 'hr_hub'`.
 */
export async function writeNotifications({
  recipients = [],
  excludeEmail,             // typically the actor — don't notify yourself
  type,                     // 'mention' | 'comment' | 'status_change' | 'assignment'
  title,
  body = '',
  requestId,
  sourceType,
  sourceId,                 // comment id when applicable, else requestId
  actor,
}) {
  const exclude = excludeEmail ? String(excludeEmail).toLowerCase() : null;
  const dedupedRecipients = Array.from(new Set(
    recipients.map(e => String(e || '').toLowerCase()).filter(Boolean),
  )).filter(e => e !== exclude);
  if (dedupedRecipients.length === 0) return 0;

  // Single multi-row INSERT keeps round-trips minimal at fan-out.
  const values = [];
  const placeholders = [];
  let p = 1;
  for (const r of dedupedRecipients) {
    placeholders.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, 'hr_hub', $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
    );
    values.push(
      r,
      type,
      title,
      body,
      String(requestId),
      sourceType,
      String(sourceId || requestId),
      actor?.email || null,
      actor?.name || null,
    );
  }
  const result = await query(
    `INSERT INTO user_notifications
       (recipient_email, type, title, body, link_view, link_id, source_type, source_id, actor_email, actor_name)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT DO NOTHING`,
    values,
  );
  return result.rowCount;
}

// ── Permission helpers ─────────────────────────────────────────────────────

/**
 * True when the caller is a full system admin OR has the per-user HR Hub
 * Admin grant on team_member_overrides. Async because the per-user flag
 * lives in the DB; result is cached in `hr-hub-admin.js` for 30 s so
 * repeated calls within a request batch are cheap.
 */
export async function isHrHubAdmin(user) {
  return await canAdministerHrHub(user);
}

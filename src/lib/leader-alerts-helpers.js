// ── Leaders Alerts: server-side helpers shared across all
//    /api/v1/leader-alerts routes (alert, comment, ack, follower, log,
//    notification, settings).
//
// Each helper is small and side-effect-explicit. Mirrors the shape of
// hr-hub-helpers.js so a future contributor can pattern-match.

import { query } from './db';
import { MEMBERS_BY_EMAIL } from '../data/members';
import { COUNTRY_OWNERS } from '../data/countryOwners';
import { canAdministerLeaderAlerts, isManagerialUser } from './leader-alerts-admin';

// ── Constants ──────────────────────────────────────────────────────────────

export const ALLOWED_STATUSES   = new Set(['new', 'in_progress', 'on_hold', 'resolved']);
export const ALLOWED_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
export const ALLOWED_SCOPES     = new Set(['mine', 'all']);
export const SPECIAL_IMPACT_TAGS = new Set(['Global', 'Team']);

// Same caps as the existing Feedback / HR Hub routes — keeps the storage
// shape consistent so the same client-side preview component renders all
// three surfaces.
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_TOTAL_PAYLOAD_BYTES = 30 * 1024 * 1024;
export const ATTACHMENT_KINDS = new Set(['image', 'video']);

// ── Sanitisers ─────────────────────────────────────────────────────────────

export function clean(str, max) {
  if (typeof str !== 'string') return null;
  const t = str.trim();
  if (!t) return null;
  return max && t.length > max ? t.slice(0, max) : t;
}

export function sanitiseLinks(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const u of raw) {
    if (typeof u !== 'string') continue;
    const t = u.trim();
    if (!t || t.length > 2000) continue;
    if (!/^https?:\/\//i.test(t)) continue;
    out.push(t);
    if (out.length >= 25) break;
  }
  return out;
}

export function sanitiseAttachments(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('attachments must be an array');
  if (raw.length > MAX_ATTACHMENTS) {
    throw Object.assign(new Error(`Too many attachments (max ${MAX_ATTACHMENTS})`), { status: 413 });
  }
  let total = 0;
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const kind = ATTACHMENT_KINDS.has(a.kind) ? a.kind : null;
    const dataUri = typeof a.dataUri === 'string' ? a.dataUri : null;
    if (!kind || !dataUri) continue;
    const expected = kind === 'image' ? 'data:image/' : 'data:video/';
    if (!dataUri.startsWith(expected)) continue;
    if (dataUri.length > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(
        new Error(`Attachment "${a.name || kind}" too large (max ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB)`),
        { status: 413 },
      );
    }
    total += dataUri.length;
    if (total > MAX_TOTAL_PAYLOAD_BYTES) {
      throw Object.assign(
        new Error(`Total attachment payload too large (max ${Math.round(MAX_TOTAL_PAYLOAD_BYTES / 1024 / 1024)} MB)`),
        { status: 413 },
      );
    }
    out.push({
      kind,
      dataUri,
      name: typeof a.name === 'string' ? a.name.slice(0, 200) : null,
    });
  }
  return out;
}

/**
 * Validate the impact_tags array. Each tag is one of:
 *   - the literal 'Global'
 *   - the literal 'Team'
 *   - a 2-letter ISO country code present in COUNTRY_OWNERS
 *
 * Drops unknown values silently rather than 400ing — the picker should
 * never produce them, but a stale client cache could.
 */
export function sanitiseImpactTags(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const v = t.trim();
    if (!v) continue;
    if (SPECIAL_IMPACT_TAGS.has(v)) {
      if (!seen.has(v)) { seen.add(v); out.push(v); }
      continue;
    }
    const upper = v.toUpperCase();
    if (upper.length === 2 && COUNTRY_OWNERS[upper]) {
      if (!seen.has(upper)) { seen.add(upper); out.push(upper); }
    }
  }
  return out;
}

// ── Member lookups ─────────────────────────────────────────────────────────

export function memberByEmail(email) {
  if (!email) return null;
  return MEMBERS_BY_EMAIL[String(email).toLowerCase()] || null;
}

/**
 * Lowercased emails of every current managerial member (TL / RM / Admin).
 * Used to compute the "missing acks" pool and to fan out Critical-severity
 * notifications. Falls back to the static MEMBERS roster — the next /me
 * call refreshes per-user grants but the role list is stable enough that
 * a fresh hydration isn't needed for every read.
 */
export function listManagerEmails() {
  const out = [];
  for (const email of Object.keys(MEMBERS_BY_EMAIL)) {
    const m = MEMBERS_BY_EMAIL[email];
    if (!m) continue;
    const access = String(m.access || '').toLowerCase();
    if (access === 'team_lead' || access === 'regional_manager' || access === 'admin') {
      out.push(email);
    }
  }
  return out;
}

// ── @mention parsing — same shape as HR Hub's parser ──────────────────────

const MENTION_TOKEN = /(?:^|[^\w])@([a-z][a-z0-9._-]{1,80})/gi;

export function parseMentions(body) {
  if (!body) return [];
  const found = new Set();
  for (const m of String(body).matchAll(MENTION_TOKEN)) {
    const token = m[1].toLowerCase();
    let hit = null;
    if (MEMBERS_BY_EMAIL[token]) hit = token;
    else if (MEMBERS_BY_EMAIL[`${token}@deel.com`]) hit = `${token}@deel.com`;
    else {
      for (const email of Object.keys(MEMBERS_BY_EMAIL)) {
        if (email.startsWith(`${token}@`)) { hit = email; break; }
      }
    }
    if (hit) found.add(hit);
  }
  return Array.from(found);
}

// ── Follower management ────────────────────────────────────────────────────

export async function addFollower(alertId, email, source = 'manual') {
  if (!alertId || !email) return false;
  const lc = String(email).toLowerCase();
  const result = await query(
    `INSERT INTO leader_alert_follower (alert_id, email, source)
     VALUES ($1, $2, $3)
     ON CONFLICT (alert_id, email) DO NOTHING`,
    [alertId, lc, source],
  );
  return result.rowCount > 0;
}

export async function removeFollower(alertId, email) {
  if (!alertId || !email) return false;
  const result = await query(
    `DELETE FROM leader_alert_follower WHERE alert_id = $1 AND LOWER(email) = $2`,
    [alertId, String(email).toLowerCase()],
  );
  return result.rowCount > 0;
}

export async function listFollowerEmails(alertId, { excludeMuted = false } = {}) {
  const sql = excludeMuted
    ? `SELECT email FROM leader_alert_follower WHERE alert_id = $1 AND muted = false`
    : `SELECT email FROM leader_alert_follower WHERE alert_id = $1`;
  const { rows } = await query(sql, [alertId]);
  return rows.map(r => r.email);
}

export async function setMute(alertId, email, muted) {
  if (!alertId || !email) return false;
  const lc = String(email).toLowerCase();
  // Upsert: a self-mute should still create the follower row so we honour it
  // even when the user wasn't already following.
  const result = await query(
    `INSERT INTO leader_alert_follower (alert_id, email, source, muted)
     VALUES ($1, $2, 'manual', $3)
     ON CONFLICT (alert_id, email)
     DO UPDATE SET muted = EXCLUDED.muted`,
    [alertId, lc, !!muted],
  );
  return result.rowCount > 0;
}

// ── Audit log ──────────────────────────────────────────────────────────────

export async function writeLog(alertId, actor, eventType, beforeJson = null, afterJson = null, client = null) {
  const runner = client || { query };
  await runner.query(
    `INSERT INTO leader_alert_log (alert_id, actor_email, actor_name, event_type, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      alertId,
      actor?.email || null,
      actor?.name || null,
      eventType,
      beforeJson ? JSON.stringify(beforeJson) : null,
      afterJson ? JSON.stringify(afterJson) : null,
    ],
  );
}

// ── Settings ───────────────────────────────────────────────────────────────

const _settingsCache = { value: null, ts: 0 };
const SETTINGS_TTL_MS = 30_000;

/**
 * Read all settings keys at once. Cached for 30 s to avoid hitting the DB
 * on every list/create call. Settings PUT routes call `bustSettingsCache()`
 * after saving so changes propagate within a single round-trip.
 */
export async function readAllSettings() {
  if (_settingsCache.value && Date.now() - _settingsCache.ts < SETTINGS_TTL_MS) {
    return _settingsCache.value;
  }
  try {
    const { rows } = await query(`SELECT key, value_json FROM leader_alert_settings`);
    const out = {};
    for (const r of rows) out[r.key] = r.value_json;
    _settingsCache.value = out;
    _settingsCache.ts = Date.now();
    return out;
  } catch (err) {
    console.warn('[leader-alerts] settings read failed:', err.message);
    return _settingsCache.value || {};
  }
}

export function bustSettingsCache() {
  _settingsCache.value = null;
  _settingsCache.ts = 0;
}

// ── Notifications (polymorphic surface) ────────────────────────────────────

/**
 * Fan out a notification to a list of recipients. De-dups on
 * (recipient_email, source_type, source_id) via the existing index.
 *
 * `sourceType` is one of: leader_alert_created_critical | leader_alert_mention
 *   | leader_alert_status_change | leader_alert_comment.
 *
 * `link_view` is always 'leader-alerts' so the bell deep-link routes via
 * App.jsx::handleNotifClick to the Leaders Alerts drawer.
 */
export async function writeNotifications({
  recipients = [],
  excludeEmail,
  type,
  title,
  body = '',
  alertId,
  sourceType,
  sourceId,
  actor,
}) {
  const exclude = excludeEmail ? String(excludeEmail).toLowerCase() : null;
  const dedupedRecipients = Array.from(new Set(
    recipients.map(e => String(e || '').toLowerCase()).filter(Boolean),
  )).filter(e => e !== exclude);
  if (dedupedRecipients.length === 0) return 0;

  const values = [];
  const placeholders = [];
  let p = 1;
  for (const r of dedupedRecipients) {
    placeholders.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, 'leader-alerts', $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
    );
    values.push(
      r,
      type,
      title,
      body,
      String(alertId),
      sourceType,
      String(sourceId || alertId),
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

// ── Permission helpers (re-exports for route handlers) ─────────────────────

export { canAdministerLeaderAlerts, isManagerialUser };

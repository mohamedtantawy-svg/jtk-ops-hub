// ── Leaders Alerts Admin permission helper ────────────────────────────────
// Server-side only. Reads the per-user `is_leader_alerts_admin` flag set
// on team_member_overrides (assigned from the Team tab via a Director or
// any access-admin). Mirrors the shape of `access-admin.js`,
// `announcements-admin.js`, and `hr-hub-admin.js` so future per-user
// grants land in the same pattern with the same caching behavior.
//
// Cache TTL is 30 s — tight enough that a freshly-revoked admin loses
// Leaders Alerts edit rights within half a minute, loose enough to avoid
// hitting the DB on every API call. `bustLeaderAlertsAdminCache(email)`
// lets the Team tab settings UI invalidate the cache the moment a flag
// flips.

import { TEAM_MEMBERS } from '../data/members';

const _cache = new Map();        // email-lowercased → { value, ts }
const TTL_MS = 30_000;

export async function isLeaderAlertsAdminEmail(email) {
  if (!email) return false;
  const lc = String(email).toLowerCase();
  const hit = _cache.get(lc);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.value;
  if (!process.env.DATABASE_URL) return false;
  try {
    const { query } = await import('./db');
    const { rows } = await query(
      'SELECT is_leader_alerts_admin FROM team_member_overrides WHERE LOWER(email) = $1',
      [lc],
    );
    const value = rows[0]?.is_leader_alerts_admin === true;
    _cache.set(lc, { value, ts: Date.now() });
    return value;
  } catch (err) {
    console.warn('[leader-alerts-admin] DB read failed:', err.message);
    return false;
  }
}

export function bustLeaderAlertsAdminCache(email) {
  if (!email) return;
  _cache.delete(String(email).toLowerCase());
}

/**
 * Combined check: full admin role OR per-user grant. Use this in routes
 * that need to gate edit-the-schema or edit-anyone's-comment behavior.
 */
export async function canAdministerLeaderAlerts(user) {
  if (!user?.email) return false;
  if (user.role === 'admin') return true;
  const baseline = TEAM_MEMBERS.find(m => m.email.toLowerCase() === user.email.toLowerCase());
  if (baseline && baseline.access === 'admin') return true;
  return await isLeaderAlertsAdminEmail(user.email);
}

/**
 * Managerial gate — used for read+write access to Leaders Alerts itself
 * (not just the admin-only settings). Any TL / RM / Admin qualifies.
 * Agents fall through to false. Mirrors the role check used by
 * permissions.js but kept local so server routes don't need to import
 * the React hook layer.
 */
export function isManagerialUser(user) {
  if (!user?.email) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'team_lead' || role === 'regional_manager') return true;
  // Roster fallback — when /me hasn't run yet the role may not be set,
  // but the static baseline can answer.
  const baseline = TEAM_MEMBERS.find(m => m.email.toLowerCase() === user.email.toLowerCase());
  if (!baseline) return false;
  const access = String(baseline.access || '').toLowerCase();
  return access === 'admin' || access === 'team_lead' || access === 'regional_manager';
}

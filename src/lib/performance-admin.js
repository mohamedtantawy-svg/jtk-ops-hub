// ── Performance Admin permission helper ────────────────────────────────────
// Server-side only. Reads the per-user `is_performance_admin` flag on
// team_member_overrides (granted from the Team tab). Mirrors hr-hub-admin.js
// exactly — 30s in-process cache, bust on flag flip. `canAdministerPerformance`
// gates schema/template edits + cross-team performance config; the org-tree
// read scope (getVisibleEmails) governs who can SEE/score which members.

import { TEAM_MEMBERS } from '../data/members';

const _cache = new Map();        // email-lowercased → { value, ts }
const TTL_MS = 30_000;

export async function isPerformanceAdminEmail(email) {
  if (!email) return false;
  const lc = String(email).toLowerCase();
  const hit = _cache.get(lc);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.value;
  if (!process.env.DATABASE_URL) return false;
  try {
    const { query } = await import('./db');
    const { rows } = await query(
      'SELECT is_performance_admin FROM team_member_overrides WHERE LOWER(email) = $1',
      [lc],
    );
    const value = rows[0]?.is_performance_admin === true;
    _cache.set(lc, { value, ts: Date.now() });
    return value;
  } catch (err) {
    console.warn('[performance-admin] DB read failed:', err.message);
    return false;
  }
}

export function bustPerformanceAdminCache(email) {
  if (!email) return;
  _cache.delete(String(email).toLowerCase());
}

/**
 * Combined check: full admin role OR per-user grant. Use in routes that gate
 * template/schema edits or cross-team performance configuration. Per-review
 * read/write scoping is handled separately by the org-tree helpers.
 */
export async function canAdministerPerformance(user) {
  if (!user?.email) return false;
  if (user.role === 'admin') return true;
  const baseline = TEAM_MEMBERS.find(m => m.email.toLowerCase() === user.email.toLowerCase());
  if (baseline && baseline.access === 'admin') return true;
  return await isPerformanceAdminEmail(user.email);
}

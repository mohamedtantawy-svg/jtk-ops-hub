// ── Access-admin permission helper ─────────────────────────────────────────
// Server-side only. Reads the per-user is_access_admin flag set on
// team_member_overrides via the Team-tab "Manage permissions" modal. Used
// by the team-members routes to extend roster-mutation rights to specific
// people without granting full admin / regional_manager.
//
// Mirrors the shape of announcements-admin.js (same TTL, same cache shape,
// same bust helper) so future roster-permission reads can be added in
// parallel without divergent caching logic.
// ──────────────────────────────────────────────────────────────────────────

import { TEAM_MEMBERS } from '../data/members';

const _cache = new Map(); // email-lowercased → { value, ts }
const TTL_MS = 30_000;

export async function isAccessAdmin(email) {
  if (!email) return false;
  const lc = String(email).toLowerCase();
  const hit = _cache.get(lc);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.value;
  if (!process.env.DATABASE_URL) return false;
  try {
    const { query } = await import('./db');
    const { rows } = await query(
      'SELECT is_access_admin FROM team_member_overrides WHERE LOWER(email) = $1',
      [lc]
    );
    const value = rows[0]?.is_access_admin === true;
    _cache.set(lc, { value, ts: Date.now() });
    return value;
  } catch (err) {
    console.warn('[access-admin] DB read failed:', err.message);
    return false;
  }
}

export function bustAccessAdminCache(email) {
  if (!email) return;
  _cache.delete(String(email).toLowerCase());
}

// Convenience for routes: returns true when the user can mutate the team
// roster — add a member, edit allocation, soft/hard-delete, toggle on-leave,
// grant other per-user permissions. Combines the historical role-tier list
// (admin / regional_manager) with the per-user grant.
export async function canManageRoster(user) {
  if (!user?.email) return false;
  if (user.role === 'admin') return true;
  const baseline = TEAM_MEMBERS.find(m => m.email.toLowerCase() === user.email.toLowerCase());
  if (baseline && (baseline.access === 'admin' || baseline.access === 'regional_manager')) return true;
  return await isAccessAdmin(user.email);
}

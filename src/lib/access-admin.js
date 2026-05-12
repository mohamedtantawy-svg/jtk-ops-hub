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

// Map legacy short-form role values used by older seeds into the canonical
// long-form the permission checks expect. Mirrors `/api/v1/me`'s
// `normaliseRole` so a user whose `members.role` was seeded as
// `regional_mgr` (or `lead`) still passes the regional_manager /
// team_lead gates downstream.
function normaliseRole(value) {
  if (!value) return null;
  const r = String(value).toLowerCase();
  if (r === 'regional_mgr') return 'regional_manager';
  if (r === 'lead') return 'team_lead';
  return r;
}

const ROSTER_ROLES = new Set(['admin', 'regional_manager']);

// Convenience for routes: returns true when the user can mutate the team
// roster — add a member, edit allocation, soft/hard-delete, toggle on-leave,
// grant other per-user permissions. Trusts the JWT-derived `user.role`
// first (hydrated from `members.role` / `team_member_overrides.access` at
// login + /me time, so a Team-tab promotion takes effect on the very next
// session). Falls back to the static baseline only when the JWT didn't
// carry a recognisable role, and finally to the per-user `is_access_admin`
// grant. Without this, a regional_manager promoted via the Team tab after
// the baseline seed was last frozen kept failing this check even though
// their JWT carried `role: regional_manager`.
export async function canManageRoster(user) {
  if (!user?.email) return false;
  const role = normaliseRole(user.role);
  if (role && ROSTER_ROLES.has(role)) return true;
  const baseline = TEAM_MEMBERS.find(m => m.email.toLowerCase() === user.email.toLowerCase());
  const baselineRole = normaliseRole(baseline?.access);
  if (baselineRole && ROSTER_ROLES.has(baselineRole)) return true;
  return await isAccessAdmin(user.email);
}

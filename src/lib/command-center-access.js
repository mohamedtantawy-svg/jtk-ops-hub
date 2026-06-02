// ── Command Center access helper ───────────────────────────────────────────
// Server-side only. Answers "can this caller read the executive Command Center
// (cross-department oversight)?" The Command Center is a DEPARTMENT; access =
// being in that department (a CC member's effective dept resolves to it) OR the
// global super-admin (who can switch into any dept via the picker). The CC
// endpoints aggregate EVERY department — the inverse of the per-dept isolation —
// so this gate is the single chokepoint every /api/v1/command-center/* route
// MUST call first, and it stays in lockstep with the FE (which only renders the
// CommandCenterApp when useCurrentDept().dept.slug === 'command-center').
//
// Allowed when ANY of:
//   • global super-admin (mohamed)                          — isGlobalSuperAdmin
//   • caller's effective dept IS the Command Center dept     — getCurrentDeptSlugAndId
//   • per-user escape-hatch grant (Team-tab toggle)          — is_command_center_viewer
//     (lets a delegate read the CC without moving their home dept; rarely needed
//      now that membership is the primary path, but retained from Phase 0.)
//
// 30 s in-memory cache on the DB flag mirrors hr-hub-admin.js / access-admin.js.

import { isGlobalSuperAdmin, getCurrentDeptSlugAndId } from './dept-scope';
import { COMMAND_CENTER_DEPT_SLUG } from './command-center-dept-seed';

const _cache = new Map(); // email-lowercased → { value, ts }
const TTL_MS = 30_000;

export async function isCommandCenterViewerEmail(email) {
  if (!email) return false;
  const lc = String(email).toLowerCase();
  const hit = _cache.get(lc);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.value;
  if (!process.env.DATABASE_URL) return false;
  try {
    const { query } = await import('./db');
    const { rows } = await query(
      'SELECT is_command_center_viewer FROM team_member_overrides WHERE LOWER(email) = $1',
      [lc],
    );
    const value = rows[0]?.is_command_center_viewer === true;
    _cache.set(lc, { value, ts: Date.now() });
    return value;
  } catch (err) {
    console.warn('[command-center-access] DB read failed:', err.message);
    return false;
  }
}

export function bustCommandCenterAccessCache(email) {
  if (!email) return;
  _cache.delete(String(email).toLowerCase());
}

/**
 * Authoritative server gate for every /api/v1/command-center/* route. Requires
 * the request so the caller's effective department can be resolved (super-admin
 * cookie-override aware). Mirrors the FE render condition (dept.slug === CC).
 */
export async function canViewCommandCenter(user, req) {
  if (!user?.email) return false;
  if (isGlobalSuperAdmin(user)) return true;
  try {
    const info = await getCurrentDeptSlugAndId(user, req);
    if (info?.deptSlug === COMMAND_CENTER_DEPT_SLUG) return true;
  } catch (err) {
    console.warn('[command-center-access] dept resolve failed:', err.message);
  }
  return await isCommandCenterViewerEmail(user.email);
}

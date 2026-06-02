// ── Command Center access helper ───────────────────────────────────────────
// Server-side only. Answers "can this user open the executive Command Center
// (cross-department oversight)?" The Command Center INVERTS the multi-tenant
// dept-scope isolation — it aggregates EVERY department in one view — so this
// gate is the single chokepoint every /api/v1/command-center/* route MUST call
// first. It is kept in exact lockstep with the FE `perms.canViewCommandCenter`
// (src/hooks/usePermissions.js) so the nav tab can never show a surface whose
// data endpoints would 403, and a 403 can never hide a tab the user can see.
//
// Access = ANY of (all server-verifiable, so FE + server agree):
//   • global super-admin (mohamed)            — isGlobalSuperAdmin
//   • seeded leadership roster                — COMMAND_CENTER_SEED_VIEWERS
//   • full system admin (role / baseline)     — role === 'admin'
//   • per-user grant (Team-tab toggle)        — team_member_overrides
//                                                .is_command_center_viewer
//
// Regional Managers are DELIBERATELY EXCLUDED — they are operational
// leadership, not C-suite / VP-Ops, and the Command Center is cross-company.
//
// 30 s in-memory cache on the DB flag mirrors hr-hub-admin.js / access-admin.js
// so a freshly-revoked viewer loses access within half a minute without a DB
// hit on every request. bustCommandCenterAccessCache(email) invalidates on flip.

import { TEAM_MEMBERS } from '../data/members';
import { COMMAND_CENTER_SEED_VIEWERS } from '../data/accessControl';
import { isGlobalSuperAdmin } from './dept-scope';

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
 * Authoritative server gate. Returns true when the caller may read the
 * executive Command Center. Mirrors FE perms.canViewCommandCenter exactly.
 */
export async function canViewCommandCenter(user) {
  if (!user?.email) return false;
  const lc = String(user.email).toLowerCase();
  if (isGlobalSuperAdmin(user)) return true;
  if (COMMAND_CENTER_SEED_VIEWERS.has(lc)) return true;
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  const baseline = TEAM_MEMBERS.find(m => m.email.toLowerCase() === lc);
  if (baseline && baseline.access === 'admin') return true;
  return await isCommandCenterViewerEmail(user.email);
}

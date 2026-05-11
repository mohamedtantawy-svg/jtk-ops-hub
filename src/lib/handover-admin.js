// ── Handover-admin permission helper ──────────────────────────────────
// Server-side only. Mirrors access-admin.js / hr-hub-admin.js: reads the
// per-user is_handover_admin flag on team_member_overrides set via the
// Team-tab "Manage permissions" modal. Used by Phase 5 routes that
// CRUD handover_settings + handover_checklist_templates + run CSV
// imports + emit the audit export.
//
// 30-second TTL — same as the other admin caches so toggling the grant
// reaches every pod within the standard "feels-instant" window.

import { TEAM_MEMBERS } from '../data/members';

const _cache = new Map(); // email-lowercased → { value, ts }
const TTL_MS = 30_000;

export async function isHandoverAdmin(email) {
  if (!email) return false;
  const lc = String(email).toLowerCase();
  const hit = _cache.get(lc);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.value;
  if (!process.env.DATABASE_URL) return false;
  try {
    const { query } = await import('./db');
    const { rows } = await query(
      'SELECT is_handover_admin FROM team_member_overrides WHERE LOWER(email) = $1',
      [lc]
    );
    const value = rows[0]?.is_handover_admin === true;
    _cache.set(lc, { value, ts: Date.now() });
    return value;
  } catch (err) {
    console.warn('[handover-admin] DB read failed:', err.message);
    return false;
  }
}

export function bustHandoverAdminCache(email) {
  if (!email) return;
  _cache.delete(String(email).toLowerCase());
}

// Convenience for routes: returns true when the user can manage the
// handover Settings panel (CRUD configurations / templates, run CSV
// imports, export audit). Combines the role-tier baseline (admin /
// regional_manager) with the per-user grant.
export async function canManageHandoverSettings(user) {
  if (!user?.email) return false;
  if (user.role === 'admin' || user.role === 'regional_manager') return true;
  const baseline = TEAM_MEMBERS.find(m => m.email.toLowerCase() === user.email.toLowerCase());
  if (baseline && (baseline.access === 'admin' || baseline.access === 'regional_manager')) return true;
  return await isHandoverAdmin(user.email);
}

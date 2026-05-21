// ── Announcements-admin permission helper ─────────────────────────────────
// Server-side only. Reads the per-user is_announcements_admin flag set on
// team_member_overrides via the Team-tab "Manage permissions" modal. Used
// by every announcement route to extend the manager-tier privilege list
// to specific people without granting full admin.

const _cache = new Map(); // email-lowercased → { value, ts }
const TTL_MS = 30_000;    // 30s — same TTL as the queue SLA settings

export async function isAnnouncementsAdmin(email) {
  if (!email) return false;
  const lc = String(email).toLowerCase();
  const hit = _cache.get(lc);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.value;
  if (!process.env.DATABASE_URL) return false;
  try {
    const { query } = await import('./db');
    const { rows } = await query(
      'SELECT is_announcements_admin FROM team_member_overrides WHERE LOWER(email) = $1',
      [lc]
    );
    const value = rows[0]?.is_announcements_admin === true;
    _cache.set(lc, { value, ts: Date.now() });
    return value;
  } catch (err) {
    console.warn('[announcements-admin] DB read failed:', err.message);
    return false;
  }
}

// Bust the cache for one email after a grant/revoke so the new value takes
// effect on the very next route hit (instead of waiting up to 30s).
export function bustAnnouncementsAdminCache(email) {
  if (!email) return;
  _cache.delete(String(email).toLowerCase());
}

// Convenience for routes: returns true when the user can perform any
// "manage announcements" action (compose, edit, archive, send-reminder,
// approve). Combines:
//   • manager-tier roles (admin / RM / manager / TL),
//   • approvers from the static roster in src/data/approvers.js — they
//     already approve / reject / publish other people's announcement
//     requests via /announcement-requests/[id]/{approve,reject,publish},
//     so being able to fix a typo on a sent announcement is the same
//     authority, just a smaller step. Without this, an approver who's
//     an `agent` in the team roster (Laura Llopis 2026-05-20 bug "once
//     posted, cannot be edited") saw the pencil button on the FE — it's
//     gated on `isApprover || isAnnAdmin` in AnnouncementsView (`isLA`)
//     — but the PATCH route 403'd because the role check below excluded
//     her. FE/BE now agree.
//   • per-user announcements admins via the Team-tab "Manage permissions"
//     modal (is_announcements_admin column on team_member_overrides).
// Pass the user object from `getAuthUser`.
export async function canManageAnnouncements(user) {
  if (!user) return false;
  if (['admin', 'regional_manager', 'manager', 'team_lead'].includes(user.role)) return true;
  if (isApprover(user.email)) return true;
  return await isAnnouncementsAdmin(user.email);
}

// Stricter variant for archive / unarchive / status changes — historically
// gated to admin/regional_manager/manager (Team Leads excluded). Now ALSO
// includes per-user announcements admins so Pilar can delegate the full
// archive workflow to a non-manager.
export async function canArchiveAnnouncements(user) {
  if (!user) return false;
  if (['admin', 'regional_manager', 'manager'].includes(user.role)) return true;
  return await isAnnouncementsAdmin(user.email);
}

// Hard-delete is admin-only by historical policy. Per-user announcements
// admin still does NOT get to hard-delete — that destroys data and remains
// a director-tier action. Reuse where the route currently checks
// `user.role === 'admin'` only if delete authority should expand later.
export async function canDeleteAnnouncements(user) {
  return user?.role === 'admin' || await isAnnouncementsAdmin(user?.email);
}

// Approval-queue actions: who can approve / reject / request-info / comment
// on announcement requests. The historical gate was `isApprover(email)` —
// a static roster in src/data/approvers.js. Per-user announcements admins
// now also count, so a Director can delegate the approval queue to a
// non-approver-listed teammate from the Team tab.
import { isApprover } from '../data/approvers';
export async function canApproveAnnouncementRequests(user) {
  if (!user) return false;
  if (isApprover(user.email)) return true;
  return await isAnnouncementsAdmin(user.email);
}

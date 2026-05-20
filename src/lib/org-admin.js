// ── Org admin permission helpers (Phase 1, 2026-05-20) ─────────────────────
// Server-side only. Two layers of authority:
//
//   1. Global edit power (admin + regional_manager via the existing
//      can_manage_org admin power). Carried in the user object handed back
//      by getAuthUser → baseline TEAM_MEMBERS access lookup.
//   2. Per-node delegation (org_node_admins). Lets a Team Lead administer
//      their own subtree without granting any global powers. Cache TTL 30 s
//      mirrors hr-hub-admin / announcements-admin / access-admin so a
//      freshly-revoked grant kicks in within half a minute.

import { TEAM_MEMBERS } from '../data/members';

const _cache = new Map();        // `${email}|${nodeId}` → { value, ts }
const TTL_MS = 30_000;

// ── Global edit power (admin + regional_manager) ─────────────────────────
// Returns true if the user holds the role-derived `can_manage_org` admin
// power. We resolve the role two ways for resilience: the JWT-derived
// `role` claim AND the baseline TEAM_MEMBERS lookup. Either positive
// answer is enough, mirroring the canAdministerHrHub pattern.
export function canManageOrgGlobal(user) {
  if (!user?.email) return false;
  if (user.role === 'admin' || user.role === 'regional_manager') return true;
  const baseline = TEAM_MEMBERS.find(
    m => m.email.toLowerCase() === user.email.toLowerCase(),
  );
  if (!baseline) return false;
  return baseline.access === 'admin' || baseline.access === 'regional_manager';
}

// ── Delegated per-node admin ─────────────────────────────────────────────
async function _isDelegatedAdminFor(email, nodeId) {
  if (!email || !nodeId) return false;
  if (!process.env.DATABASE_URL) return false;
  const key = `${email.toLowerCase()}|${nodeId}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.value;
  try {
    const { query } = await import('./db');
    // A delegated admin's authority extends to the granted node AND every
    // descendant. We walk up the chain from the requested node — if any
    // ancestor (inclusive) has a grant for this email, the user is
    // authorised. Postgres recursive CTE keeps it to one round-trip.
    const { rows } = await query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_id FROM org_nodes WHERE id = $2
         UNION ALL
         SELECT n.id, n.parent_id
           FROM org_nodes n
           JOIN chain c ON n.id = c.parent_id
       )
       SELECT 1
         FROM chain c
         JOIN org_node_admins a ON a.node_id = c.id
        WHERE LOWER(a.email) = $1
        LIMIT 1`,
      [email.toLowerCase(), nodeId],
    );
    const value = rows.length > 0;
    _cache.set(key, { value, ts: Date.now() });
    return value;
  } catch (err) {
    console.warn('[org-admin] DB read failed:', err.message);
    return false;
  }
}

/**
 * Can this user edit this specific node (create/rename/move/archive
 * children, edit members of this subtree)?
 *   • Global org-admin (admin / regional_manager) → yes, anywhere.
 *   • Delegated grant in org_node_admins covering the node or any
 *     ancestor → yes, for this subtree only.
 *   • Anyone else → no.
 *
 * Pass nodeId = null for "any-node" intent (e.g. creating a new root
 * department); only global org-admins clear that gate.
 */
export async function canManageOrgNode(user, nodeId) {
  if (!user?.email) return false;
  if (canManageOrgGlobal(user)) return true;
  if (!nodeId) return false;
  return await _isDelegatedAdminFor(user.email, nodeId);
}

/**
 * Convenience wrapper for routes that need either form of admin authority
 * for ANY node. Used by the GET /api/v1/org/nodes list endpoint — read
 * access is open to everyone (Q10/Q11 spec lock), but the response shape
 * gates edit-flag fields (e.g. canEdit) behind this check.
 */
export function hasAnyOrgEditPower(user) {
  return canManageOrgGlobal(user);
}

export function bustOrgAdminCache(email, nodeId) {
  if (!email) {
    _cache.clear();
    return;
  }
  const lc = email.toLowerCase();
  if (!nodeId) {
    for (const key of _cache.keys()) {
      if (key.startsWith(`${lc}|`)) _cache.delete(key);
    }
    return;
  }
  _cache.delete(`${lc}|${nodeId}`);
}

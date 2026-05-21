// ── Dept-scope resolver (Phase 11a — 2026-05-20) ───────────────────────────
// Server-side helper that answers "which top-level department is the current
// request scoped to?" Every isolated read in the multi-tenant rollout uses
// this to filter rows. Every write uses it to stamp ownership.
//
// Resolution order:
//   1. If the user is the global super-admin AND has a `ops_hub_super_admin_dept`
//      cookie pointing at an active top-level dept → that dept wins.
//   2. Otherwise → walk team_member_overrides.org_node_id → org_nodes.parent_id
//      chain until parent_id IS NULL. Return that top-level dept.
//
// HRX-no-impact guarantee: all existing override rows were stamped with
// EOR Operations (a TEAM under HR Experience) at Phase 0. The recursive CTE
// walks EOR Operations → HR Experience → null parent, returning HR
// Experience's UUID. After the Phase 11a backfill stamps every existing
// surface row with the same HR Experience UUID, the read filters match
// every existing row exactly, so HRX users see identical data to today.
//
// Cache: 30s in-process Map keyed by lowercased email. Cleared per-email
// after team-members PATCH (existing invalidateRosterCache path).

import { query } from './db';

export const GLOBAL_SUPER_ADMIN_EMAIL = 'mohamed.tantawy@deel.com';
export const SUPER_ADMIN_DEPT_COOKIE = 'ops_hub_super_admin_dept';

const _cache = new Map(); // email -> { value: { deptId, deptName } | null, ts }
const TTL_MS = 30_000;

export function isGlobalSuperAdmin(user) {
  if (!user?.email) return false;
  return String(user.email).toLowerCase() === GLOBAL_SUPER_ADMIN_EMAIL;
}

export function clearDeptScopeCache(email) {
  if (!email) { _cache.clear(); return; }
  _cache.delete(String(email).toLowerCase());
}

// Returns { deptId, deptName, deptSlug } for the user's top-level dept,
// or null when they have no org_node_id (= unassigned). The slug is the
// key Phase 13a uses to look up per-department integration config.
export async function getTopLevelDeptForMember(email) {
  if (!email) return null;
  const lc = String(email).toLowerCase();
  const cached = _cache.get(lc);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.value;
  try {
    const { rows } = await query(
      `WITH RECURSIVE chain AS (
         SELECT n.id, n.parent_id, n.name, n.slug, 1 AS depth
           FROM team_member_overrides tmo
           JOIN org_nodes n ON n.id = tmo.org_node_id
          WHERE LOWER(tmo.email) = $1 AND n.is_archived = false
         UNION ALL
         SELECT p.id, p.parent_id, p.name, p.slug, c.depth + 1
           FROM chain c
           JOIN org_nodes p ON p.id = c.parent_id
          WHERE p.is_archived = false
       )
       SELECT id, name, slug FROM chain WHERE parent_id IS NULL LIMIT 1`,
      [lc],
    );
    const value = rows[0]
      ? { deptId: rows[0].id, deptName: rows[0].name, deptSlug: rows[0].slug }
      : null;
    _cache.set(lc, { value, ts: Date.now() });
    return value;
  } catch (err) {
    console.warn('[dept-scope] resolve failed:', err.message);
    return null;
  }
}

// Read super-admin's selected dept from the request cookie.
function readSuperAdminCookie(req) {
  if (!req) return null;
  try {
    const cookieHeader = req.headers?.get?.('cookie') || '';
    const match = cookieHeader.match(new RegExp(`(?:^|; )${SUPER_ADMIN_DEPT_COOKIE}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

// The canonical resolver. Every isolated route calls this.
// Super-admin gets cookie-overridden dept; everyone else gets their own
// home dept always (no cross-tenant escape possible via tampered cookies).
export async function getCurrentDeptId(user, req) {
  if (!user?.email) return null;
  if (isGlobalSuperAdmin(user)) {
    const cookieDeptId = readSuperAdminCookie(req);
    if (cookieDeptId) {
      try {
        const { rows } = await query(
          `SELECT id FROM org_nodes
            WHERE id = $1 AND parent_id IS NULL AND is_archived = false LIMIT 1`,
          [cookieDeptId],
        );
        if (rows[0]) return rows[0].id;
      } catch { /* fall through to home dept */ }
    }
  }
  const top = await getTopLevelDeptForMember(user.email);
  return top?.deptId || null;
}

// Phase 13a (2026-05-20): resolve the slug + id for the caller's effective
// dept (super-admin cookie wins when set; everyone else gets their own).
// Returns { deptId, deptSlug } or null. The slug is what dept-integrations
// uses to look up per-dept Zendesk/Jira/Workbench/Deel-source config.
export async function getCurrentDeptSlugAndId(user, req) {
  if (!user?.email) return null;
  if (isGlobalSuperAdmin(user)) {
    const cookieDeptId = readSuperAdminCookie(req);
    if (cookieDeptId) {
      try {
        const { rows } = await query(
          `SELECT id, slug FROM org_nodes
            WHERE id = $1 AND parent_id IS NULL AND is_archived = false LIMIT 1`,
          [cookieDeptId],
        );
        if (rows[0]) return { deptId: rows[0].id, deptSlug: rows[0].slug };
      } catch { /* fall through */ }
    }
  }
  const top = await getTopLevelDeptForMember(user.email);
  if (!top) return null;
  return { deptId: top.deptId, deptSlug: top.deptSlug };
}

// List every active top-level dept for the super-admin picker.
export async function listTopLevelDepts() {
  try {
    const { rows } = await query(
      `SELECT id, name, slug FROM org_nodes
        WHERE parent_id IS NULL AND is_archived = false
        ORDER BY sort_order, name`,
    );
    return rows.map(r => ({ id: r.id, name: r.name, slug: r.slug }));
  } catch (err) {
    console.warn('[dept-scope] listTopLevelDepts failed:', err.message);
    return [];
  }
}

// 2026-05-21 — fix for the Team Summary / ack-tracker dept-filter that
// shipped in PR #745. The original FE filter compared
// `member.orgNodeId === currentDeptId`, which always fails for HRX
// because every existing override row points at a SUB-team UUID
// (EOR Operations, EMEA 1, Next-Gen HR, etc.) — never the top-level
// HR Experience UUID. `allAgents` collapsed to ~0–1 rows and Team
// Summary / Overall Capacity went to zeros for every user. Fix:
// return the dept's UUID + every descendant org_node.id so the FE can
// do a Set membership check instead of equality.
//
// Walks the org_nodes tree once via recursive CTE; returns the FULL
// sub-tree below (and including) the given dept. Archived nodes are
// excluded so a deleted-then-restored team doesn't silently absorb
// agents who used to belong to it.
export async function getDescendantNodeIds(rootDeptId) {
  if (!rootDeptId) return [];
  try {
    const { rows } = await query(
      `WITH RECURSIVE subtree AS (
         SELECT id, parent_id
           FROM org_nodes
          WHERE id = $1 AND is_archived = false
         UNION ALL
         SELECT n.id, n.parent_id
           FROM org_nodes n
           JOIN subtree s ON n.parent_id = s.id
          WHERE n.is_archived = false
       )
       SELECT id FROM subtree`,
      [rootDeptId],
    );
    return rows.map(r => r.id);
  } catch (err) {
    console.warn('[dept-scope] getDescendantNodeIds failed:', err.message);
    return [];
  }
}

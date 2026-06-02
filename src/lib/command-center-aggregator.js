// ── Command Center aggregator (Phase 0 — 2026-06-03) ────────────────────────
// Server-side cross-DEPARTMENT rollups for the executive Command Center. Where
// every other aggregator scopes to ONE dept (getCurrentDeptId), this one loops
// EVERY active top-level department in org_nodes — the inverse of the multi-
// tenant isolation. Callers MUST gate with canViewCommandCenter()
// (command-center-access.js) BEFORE invoking anything here; this module assumes
// the caller is already authorised.
//
// Phase 0 ships getOverview() only: the live department roster + headcount +
// team count, enumerated from org_nodes at request time so the Command Center
// adapts automatically when a department is added / renamed / archived — no
// hardcoded dept list (honours skill mistake #50: slugs/depts are user-managed).
// Later phases layer per-dept health / SLA / volume / capacity / people / risk
// rollups onto this same enumeration.

import { query } from './db';

/**
 * Live list of active top-level departments with whole-subtree headcount.
 * Returns [] (never throws) so one bad query can't 500 the exec dashboard.
 *
 * Headcount = distinct non-deleted team_member_overrides rows whose org_node_id
 * sits anywhere in the department's subtree (dept → teams → sub-teams), matching
 * how the Org tab counts a department's people.
 */
export async function listDepartmentsWithHeadcount() {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { rows } = await query(
      `WITH RECURSIVE subtree AS (
         -- seed: every active top-level department is the root of its own tree
         SELECT id AS node_id, id AS root_id
           FROM org_nodes
          WHERE parent_id IS NULL AND is_archived = false
         UNION ALL
         SELECT n.id, s.root_id
           FROM org_nodes n
           JOIN subtree s ON n.parent_id = s.node_id
          WHERE n.is_archived = false
       )
       SELECT r.id, r.name, r.slug, r.color, r.icon, r.sort_order,
              COUNT(DISTINCT s.node_id)::int AS node_count,
              COUNT(DISTINCT tmo.email) FILTER (
                WHERE tmo.email IS NOT NULL
                  AND (tmo.is_deleted IS NULL OR tmo.is_deleted = false)
              )::int AS headcount
         FROM org_nodes r
         JOIN subtree s ON s.root_id = r.id
         LEFT JOIN team_member_overrides tmo ON tmo.org_node_id = s.node_id
        WHERE r.parent_id IS NULL AND r.is_archived = false
        GROUP BY r.id, r.name, r.slug, r.color, r.icon, r.sort_order
        ORDER BY r.sort_order NULLS LAST, r.name`,
    );
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      color: r.color || null,
      icon: r.icon || null,
      sortOrder: r.sort_order,
      // node_count includes the department node itself; teams = the rest.
      teamCount: Math.max(0, (r.node_count || 1) - 1),
      headcount: r.headcount || 0,
    }));
  } catch (err) {
    console.warn('[command-center-aggregator] listDepartmentsWithHeadcount failed:', err.message);
    return [];
  }
}

/**
 * Phase 0 overview payload: the live department roster + org-wide totals.
 * Metric rollups (health, SLA, volume, …) layer onto this in later phases.
 */
export async function getOverview() {
  const departments = await listDepartmentsWithHeadcount();
  return {
    departments,
    totals: {
      departmentCount: departments.length,
      teamCount: departments.reduce((sum, d) => sum + (d.teamCount || 0), 0),
      headcount: departments.reduce((sum, d) => sum + (d.headcount || 0), 0),
    },
  };
}

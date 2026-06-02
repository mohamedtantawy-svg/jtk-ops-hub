// ── Command Center aggregator (Phases 0–1 — 2026-06-03) ─────────────────────
// Server-side cross-DEPARTMENT rollups for the executive Command Center. Where
// every other aggregator scopes to ONE dept (getCurrentDeptId), this one loops
// EVERY active top-level department in org_nodes — the inverse of the multi-
// tenant isolation. Callers MUST gate with canViewCommandCenter()
// (command-center-access.js) BEFORE invoking anything here.
//
// Phase 0: live dept roster + headcount.
// Phase 1: per-department operational scorecards from INTERNAL dept-scoped
//   tables only — fast indexed GROUP BYs, NO external (Zendesk/Jira/Deel) scans
//   (per COMMAND_CENTER_PLAN.md §3.3 performance posture). The queue-based SLA /
//   composite Health Score lands in Phase 2 where the SLA model is rolled up.
//
// Departments are enumerated live from org_nodes, so the Command Center adapts
// automatically when a dept is added / renamed / archived (no hardcoded list —
// honours skill mistake #50). Metric rows are keyed by org_node_id and folded
// up to their top-level department in JS via a single node→root resolver, so we
// run one flat GROUP BY per source instead of a recursive CTE per source.

import { query } from './db';
import { COMMAND_CENTER_DEPT_SLUG } from './command-center-dept-seed';

const ROOT_WALK_CAP = 16; // defence against accidental org_nodes cycles

// Active node set → { roots[], resolveRoot(id), nodesByRoot } resolver.
async function loadNodeTree() {
  const { rows } = await query(
    `SELECT id, parent_id, name, slug, color, icon, sort_order
       FROM org_nodes
      WHERE is_archived = false`,
  );
  const parent = new Map();
  for (const n of rows) parent.set(n.id, n.parent_id || null);

  const rootCache = new Map();
  const resolveRoot = (id) => {
    if (!id) return null;
    if (rootCache.has(id)) return rootCache.get(id);
    let cur = id;
    let depth = 0;
    // Walk up while the current node has a parent that's still in the active
    // set. Stops at a top-level dept (parent_id null) or an orphan (parent
    // archived/missing) — orphans resolve to themselves and are dropped on fold.
    while (cur && parent.get(cur) && depth < ROOT_WALK_CAP) {
      cur = parent.get(cur);
      depth += 1;
    }
    rootCache.set(id, cur);
    return cur;
  };

  const roots = rows
    // Exclude the Command Center department itself — it is the OBSERVER (its
    // members are execs; it has no operational data to roll up).
    .filter(n => !n.parent_id && n.slug !== COMMAND_CENTER_DEPT_SLUG)
    .map(n => ({
      id: n.id, name: n.name, slug: n.slug,
      color: n.color || null, icon: n.icon || null,
      sortOrder: n.sort_order,
    }));

  // teamCount per root = active descendant nodes (excluding the dept node itself).
  const teamCountByRoot = new Map();
  for (const n of rows) {
    const root = resolveRoot(n.id);
    if (!root || n.id === root) continue; // skip the dept node itself
    teamCountByRoot.set(root, (teamCountByRoot.get(root) || 0) + 1);
  }

  return { rows, resolveRoot, roots, teamCountByRoot };
}

// Run a per-node-id GROUP BY and fold the integer tallies up to the root dept.
// `pick(row)` returns { nodeId, values: {k: int, …} }. Returns Map<rootId, {k:int}>.
async function foldByRoot(sql, resolveRoot, pick) {
  const out = new Map();
  let rows = [];
  try {
    ({ rows } = await query(sql));
  } catch (err) {
    console.warn('[command-center-aggregator] rollup query failed:', err.message);
    return out; // fail-soft: this metric reads 0 everywhere, board still renders
  }
  for (const r of rows) {
    const { nodeId, values } = pick(r);
    const root = resolveRoot(nodeId);
    if (!root) continue;
    const acc = out.get(root) || {};
    for (const [k, v] of Object.entries(values)) acc[k] = (acc[k] || 0) + (Number(v) || 0);
    out.set(root, acc);
  }
  return out;
}

/**
 * Phase 1 overview: live department roster + per-dept operational scorecards +
 * org-wide totals. Internal data only (no external scans). Returns a safe empty
 * shape (never throws) so one bad query can't 500 the exec dashboard.
 */
export async function getOverview() {
  if (!process.env.DATABASE_URL) {
    return { departments: [], totals: emptyTotals() };
  }

  let tree;
  try {
    tree = await loadNodeTree();
  } catch (err) {
    console.warn('[command-center-aggregator] loadNodeTree failed:', err.message);
    return { departments: [], totals: emptyTotals() };
  }
  const { resolveRoot, roots, teamCountByRoot } = tree;
  if (roots.length === 0) return { departments: [], totals: emptyTotals() };

  // Headcount — distinct people per node (each person lives in exactly one node,
  // so fold-summing per-node counts to the root yields the true subtree total).
  const headcount = await foldByRoot(
    `SELECT org_node_id, COUNT(DISTINCT LOWER(email))::int AS c
       FROM team_member_overrides
      WHERE org_node_id IS NOT NULL AND (is_deleted IS NULL OR is_deleted = false)
      GROUP BY org_node_id`,
    resolveRoot,
    r => ({ nodeId: r.org_node_id, values: { headcount: r.c } }),
  );

  // HR Hub — open (not resolved/rejected) + urgent (high/critical priority).
  const hrHub = await foldByRoot(
    `SELECT org_node_id,
            COUNT(*)::int AS open_c,
            COUNT(*) FILTER (WHERE priority IN ('high','critical'))::int AS urgent_c
       FROM hr_hub_request
      WHERE org_node_id IS NOT NULL AND status NOT IN ('resolved','rejected')
      GROUP BY org_node_id`,
    resolveRoot,
    r => ({ nodeId: r.org_node_id, values: { hrHubOpen: r.open_c, hrHubUrgent: r.urgent_c } }),
  );

  // Open vacancies (org_vacant_roles is keyed by node_id).
  const vacancies = await foldByRoot(
    `SELECT node_id, COUNT(*)::int AS c FROM org_vacant_roles GROUP BY node_id`,
    resolveRoot,
    r => ({ nodeId: r.node_id, values: { vacancies: r.c } }),
  );

  // People out today — attributed via the MEMBER's dept (the source of truth),
  // not the (laggier) time_off_events.org_node_id. Approved leave overlapping today.
  const outToday = await foldByRoot(
    `SELECT tmo.org_node_id,
            COUNT(DISTINCT LOWER(t.work_email))::int AS c
       FROM time_off_events t
       JOIN team_member_overrides tmo ON LOWER(tmo.email) = LOWER(t.work_email)
      WHERE t.status = 'approved'
        AND t.start_date <= CURRENT_DATE AND t.end_date >= CURRENT_DATE
        AND tmo.org_node_id IS NOT NULL AND (tmo.is_deleted IS NULL OR tmo.is_deleted = false)
      GROUP BY tmo.org_node_id`,
    resolveRoot,
    r => ({ nodeId: r.org_node_id, values: { outToday: r.c } }),
  );

  const departments = roots
    .map(d => {
      const h = headcount.get(d.id) || {};
      const hh = hrHub.get(d.id) || {};
      const v = vacancies.get(d.id) || {};
      const o = outToday.get(d.id) || {};
      return {
        id: d.id, name: d.name, slug: d.slug, color: d.color, icon: d.icon, sortOrder: d.sortOrder,
        teamCount: teamCountByRoot.get(d.id) || 0,
        headcount: h.headcount || 0,
        hrHubOpen: hh.hrHubOpen || 0,
        hrHubUrgent: hh.hrHubUrgent || 0,
        vacancies: v.vacancies || 0,
        outToday: o.outToday || 0,
      };
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));

  const totals = departments.reduce((t, d) => ({
    departmentCount: t.departmentCount + 1,
    teamCount: t.teamCount + d.teamCount,
    headcount: t.headcount + d.headcount,
    hrHubOpen: t.hrHubOpen + d.hrHubOpen,
    hrHubUrgent: t.hrHubUrgent + d.hrHubUrgent,
    vacancies: t.vacancies + d.vacancies,
    outToday: t.outToday + d.outToday,
  }), emptyTotals());

  return { departments, totals };
}

function emptyTotals() {
  return { departmentCount: 0, teamCount: 0, headcount: 0, hrHubOpen: 0, hrHubUrgent: 0, vacancies: 0, outToday: 0 };
}

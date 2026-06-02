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
import { COMMAND_CENTER_SOURCES } from '../data/commandCenterSources';
import { visibleDeelSourcesFor } from './dept-integrations';
import { getCommandCenterSettings, CC_SETTINGS_DEFAULTS } from './command-center-settings';

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
async function foldByRoot(sql, resolveRoot, pick, params = []) {
  const out = new Map();
  let rows = [];
  try {
    ({ rows } = await query(sql, params));
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

// ── Shared HR Hub per-department stats (open / urgent / aged buckets / 30-day
//    flow), folded to the root dept. "Aged" uses calendar-day age as an SLA
//    proxy for the internal HR Hub queue: breached > 7d open, at-risk 2–7d.
//    (Queue/Deel SLA is per-dept + external — surfaced in each dept's own
//    queue; the CC rolls up the internal HR Hub signal here.)
async function hrHubStatsByRoot(resolveRoot, { breachDays = 7, atRiskDays = 2 } = {}) {
  return foldByRoot(
    `SELECT org_node_id,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved','rejected'))::int AS open_c,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved','rejected') AND priority IN ('high','critical'))::int AS urgent_c,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved','rejected') AND created_at <  NOW() - ($1 * INTERVAL '1 day'))::int AS breached_c,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved','rejected') AND created_at <  NOW() - ($2 * INTERVAL '1 day') AND created_at >= NOW() - ($1 * INTERVAL '1 day'))::int AS atrisk_c,
            COUNT(*) FILTER (WHERE created_at  >= NOW() - INTERVAL '30 days')::int AS created30_c,
            COUNT(*) FILTER (WHERE resolved_at >= NOW() - INTERVAL '30 days')::int AS resolved30_c
       FROM hr_hub_request
      WHERE org_node_id IS NOT NULL
      GROUP BY org_node_id`,
    resolveRoot,
    r => ({ nodeId: r.org_node_id, values: {
      open: r.open_c, urgent: r.urgent_c, breached: r.breached_c,
      atRisk: r.atrisk_c, created30: r.created30_c, resolved30: r.resolved30_c,
    } }),
    [breachDays, atRiskDays],
  );
}

async function headcountVacancyByRoot(resolveRoot) {
  const head = await foldByRoot(
    `SELECT org_node_id, COUNT(DISTINCT LOWER(email))::int AS c
       FROM team_member_overrides
      WHERE org_node_id IS NOT NULL AND (is_deleted IS NULL OR is_deleted = false)
      GROUP BY org_node_id`,
    resolveRoot, r => ({ nodeId: r.org_node_id, values: { headcount: r.c } }),
  );
  const vac = await foldByRoot(
    `SELECT node_id, COUNT(*)::int AS c FROM org_vacant_roles GROUP BY node_id`,
    resolveRoot, r => ({ nodeId: r.node_id, values: { vacancies: r.c } }),
  );
  return { head, vac };
}

// Composite Command Center Health Score (0–100) from internal signals. Weighted:
//   Backlog 40 (share of open NOT aged-breached) · Resolution 30 (30-day
//   resolved/created throughput) · Urgent 15 (share of open NOT high/critical) ·
//   Staffing 15 (filled share of headcount+vacancies). Transparent components
//   returned so the UI can show the breakdown. Bands: ≥80 / ≥60 / <60.
function healthFromStats(s, weights = CC_SETTINGS_DEFAULTS.healthWeights) {
  const open = s.open || 0, breached = s.breached || 0, urgent = s.urgent || 0;
  const created30 = s.created30 || 0, resolved30 = s.resolved30 || 0;
  const headcount = s.headcount || 0, vacancies = s.vacancies || 0;
  const backlog    = open > 0 ? Math.round((1 - breached / open) * 100) : 100;
  const resolution = created30 > 0 ? Math.min(100, Math.round((resolved30 / created30) * 100)) : 100;
  const urgentScore = open > 0 ? Math.round((1 - urgent / open) * 100) : 100;
  const staffing   = (headcount + vacancies) > 0 ? Math.round((headcount / (headcount + vacancies)) * 100) : 100;
  const w = weights || CC_SETTINGS_DEFAULTS.healthWeights;
  const wSum = (w.backlog + w.resolution + w.urgent + w.staffing) || 100;
  const score = Math.round((backlog * w.backlog + resolution * w.resolution + urgentScore * w.urgent + staffing * w.staffing) / wSum);
  return { score, components: { backlog, resolution, urgent: urgentScore, staffing } };
}

function sumStats(list) {
  return list.reduce((t, d) => ({
    open: t.open + (d.open || 0), breached: t.breached + (d.breached || 0),
    urgent: t.urgent + (d.urgent || 0), atRisk: t.atRisk + (d.atRisk || 0),
    created30: t.created30 + (d.created30 || 0), resolved30: t.resolved30 + (d.resolved30 || 0),
    headcount: t.headcount + (d.headcount || 0), vacancies: t.vacancies + (d.vacancies || 0),
  }), { open: 0, breached: 0, urgent: 0, atRisk: 0, created30: 0, resolved30: 0, headcount: 0, vacancies: 0 });
}

// Health tab: per-dept composite + component breakdown + org-wide roll-up.
export async function getHealth() {
  const empty = { departments: [], org: { score: 100, components: {} } };
  if (!process.env.DATABASE_URL) return empty;
  let tree;
  try { tree = await loadNodeTree(); } catch (err) { console.warn('[cc-agg getHealth]', err.message); return empty; }
  const { resolveRoot, roots } = tree;
  if (!roots.length) return empty;
  const settings = await getCommandCenterSettings();
  const hh = await hrHubStatsByRoot(resolveRoot, { breachDays: settings.slaBreachDays, atRiskDays: settings.slaAtRiskDays });
  const { head, vac } = await headcountVacancyByRoot(resolveRoot);
  const departments = roots.map(d => {
    const s = { ...(hh.get(d.id) || {}), headcount: (head.get(d.id) || {}).headcount || 0, vacancies: (vac.get(d.id) || {}).vacancies || 0 };
    const h = healthFromStats(s, settings.healthWeights);
    return { id: d.id, name: d.name, slug: d.slug, color: d.color, score: h.score, components: h.components,
      open: s.open || 0, breached: s.breached || 0, urgent: s.urgent || 0,
      created30: s.created30 || 0, resolved30: s.resolved30 || 0, headcount: s.headcount, vacancies: s.vacancies };
  }).sort((a, b) => a.score - b.score); // worst-first so execs see attention items up top
  const agg = sumStats(departments);
  return { departments, org: { ...healthFromStats(agg, settings.healthWeights), ...agg } };
}

// SLA tab: internal HR Hub ageing — fresh / at-risk / breached + urgent, per dept.
export async function getSla() {
  const empty = { departments: [], totals: { open: 0, breached: 0, atRisk: 0, fresh: 0, urgent: 0, compliance: 100 } };
  if (!process.env.DATABASE_URL) return empty;
  let tree;
  try { tree = await loadNodeTree(); } catch (err) { console.warn('[cc-agg getSla]', err.message); return empty; }
  const { resolveRoot, roots } = tree;
  if (!roots.length) return empty;
  const settings = await getCommandCenterSettings();
  const hh = await hrHubStatsByRoot(resolveRoot, { breachDays: settings.slaBreachDays, atRiskDays: settings.slaAtRiskDays });
  const departments = roots.map(d => {
    const s = hh.get(d.id) || {};
    const open = s.open || 0, breached = s.breached || 0, atRisk = s.atRisk || 0, urgent = s.urgent || 0;
    return { id: d.id, name: d.name, slug: d.slug, color: d.color, open, breached, atRisk,
      fresh: Math.max(0, open - breached - atRisk), urgent,
      compliance: open > 0 ? Math.round(((open - breached) / open) * 100) : 100 };
  }).sort((a, b) => b.breached - a.breached || a.compliance - b.compliance);
  const t = sumStats(departments);
  const totals = { open: t.open, breached: t.breached, atRisk: t.atRisk,
    fresh: Math.max(0, t.open - t.breached - t.atRisk), urgent: t.urgent,
    compliance: t.open > 0 ? Math.round(((t.open - t.breached) / t.open) * 100) : 100 };
  return { departments, totals };
}

// Volume tab: org-wide created-vs-resolved daily series + per-dept totals over a
// configurable window (7 / 30 / 90 days — default from settings, override via opts).
export async function getVolume({ days } = {}) {
  const settings = await getCommandCenterSettings();
  const win = [7, 30, 90].includes(Number(days)) ? Number(days) : settings.volumeDays;
  const empty = { series: [], departments: [], totals: { created: 0, resolved: 0, openNow: 0 }, windowDays: win };
  if (!process.env.DATABASE_URL) return empty;
  let tree;
  try { tree = await loadNodeTree(); } catch (err) { console.warn('[cc-agg getVolume]', err.message); return empty; }
  const { resolveRoot, roots } = tree;
  if (!roots.length) return empty;

  let createdRows = [], resolvedRows = [];
  try { ({ rows: createdRows } = await query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d, COUNT(*)::int AS c FROM hr_hub_request WHERE created_at >= NOW() - ($1 * INTERVAL '1 day') GROUP BY 1`, [win])); } catch (e) { console.warn('[cc-agg getVolume created]', e.message); }
  try { ({ rows: resolvedRows } = await query(`SELECT to_char(date_trunc('day', resolved_at), 'YYYY-MM-DD') AS d, COUNT(*)::int AS c FROM hr_hub_request WHERE resolved_at >= NOW() - ($1 * INTERVAL '1 day') GROUP BY 1`, [win])); } catch (e) { console.warn('[cc-agg getVolume resolved]', e.message); }
  const cBy = Object.fromEntries(createdRows.map(r => [r.d, r.c]));
  const rBy = Object.fromEntries(resolvedRows.map(r => [r.d, r.c]));
  const series = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = win - 1; i >= 0; i--) {
    const dt = new Date(today); dt.setUTCDate(dt.getUTCDate() - i);
    const key = dt.toISOString().slice(0, 10);
    series.push({ date: key, created: cBy[key] || 0, resolved: rBy[key] || 0 });
  }

  const byDept = await foldByRoot(
    `SELECT org_node_id,
            COUNT(*) FILTER (WHERE created_at  >= NOW() - ($1 * INTERVAL '1 day'))::int AS created_c,
            COUNT(*) FILTER (WHERE resolved_at >= NOW() - ($1 * INTERVAL '1 day'))::int AS resolved_c,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved','rejected'))::int AS open_c
       FROM hr_hub_request WHERE org_node_id IS NOT NULL GROUP BY org_node_id`,
    resolveRoot,
    r => ({ nodeId: r.org_node_id, values: { created: r.created_c, resolved: r.resolved_c, openNow: r.open_c } }),
    [win],
  );
  const departments = roots.map(d => {
    const s = byDept.get(d.id) || {};
    return { id: d.id, name: d.name, slug: d.slug, color: d.color, created: s.created || 0, resolved: s.resolved || 0, openNow: s.openNow || 0 };
  }).sort((a, b) => b.created - a.created);
  const totals = {
    created: series.reduce((t, x) => t + x.created, 0),
    resolved: series.reduce((t, x) => t + x.resolved, 0),
    openNow: departments.reduce((t, d) => t + d.openNow, 0),
  };
  return { series, departments, totals, windowDays: win };
}

// Risk tab: open Leader Alerts / Urgent Assists / Escalations per dept (+ critical).
export async function getRisk() {
  const empty = { departments: [], totals: { alertsOpen: 0, alertsCritical: 0, urgentOpen: 0, urgentCritical: 0, escalationsOpen: 0, total: 0, critical: 0 } };
  if (!process.env.DATABASE_URL) return empty;
  let tree;
  try { tree = await loadNodeTree(); } catch (e) { console.warn('[cc-agg getRisk]', e.message); return empty; }
  const { resolveRoot, roots } = tree;
  if (!roots.length) return empty;

  const alerts = await foldByRoot(
    `SELECT org_node_id,
            COUNT(*) FILTER (WHERE status <> 'resolved')::int AS open_c,
            COUNT(*) FILTER (WHERE status <> 'resolved' AND severity IN ('critical','high'))::int AS crit_c
       FROM leader_alert WHERE org_node_id IS NOT NULL GROUP BY org_node_id`,
    resolveRoot, r => ({ nodeId: r.org_node_id, values: { alertsOpen: r.open_c, alertsCritical: r.crit_c } }),
  );
  const urgent = await foldByRoot(
    `SELECT org_node_id,
            COUNT(*) FILTER (WHERE status <> 'resolved')::int AS open_c,
            COUNT(*) FILTER (WHERE status <> 'resolved' AND priority IN ('critical','high'))::int AS crit_c
       FROM urgent_assist_request WHERE org_node_id IS NOT NULL GROUP BY org_node_id`,
    resolveRoot, r => ({ nodeId: r.org_node_id, values: { urgentOpen: r.open_c, urgentCritical: r.crit_c } }),
  );
  const escal = await foldByRoot(
    `SELECT org_node_id, COUNT(*) FILTER (WHERE status IN ('pending','in_progress'))::int AS open_c
       FROM escalations WHERE org_node_id IS NOT NULL GROUP BY org_node_id`,
    resolveRoot, r => ({ nodeId: r.org_node_id, values: { escalationsOpen: r.open_c } }),
  );

  const departments = roots.map(d => {
    const a = alerts.get(d.id) || {}, u = urgent.get(d.id) || {}, e = escal.get(d.id) || {};
    const alertsOpen = a.alertsOpen || 0, alertsCritical = a.alertsCritical || 0;
    const urgentOpen = u.urgentOpen || 0, urgentCritical = u.urgentCritical || 0;
    const escalationsOpen = e.escalationsOpen || 0;
    return { id: d.id, name: d.name, slug: d.slug, color: d.color, alertsOpen, alertsCritical, urgentOpen, urgentCritical, escalationsOpen,
      total: alertsOpen + urgentOpen + escalationsOpen, critical: alertsCritical + urgentCritical };
  }).sort((a, b) => b.critical - a.critical || b.total - a.total);

  const totals = departments.reduce((t, d) => ({
    alertsOpen: t.alertsOpen + d.alertsOpen, alertsCritical: t.alertsCritical + d.alertsCritical,
    urgentOpen: t.urgentOpen + d.urgentOpen, urgentCritical: t.urgentCritical + d.urgentCritical,
    escalationsOpen: t.escalationsOpen + d.escalationsOpen, total: t.total + d.total, critical: t.critical + d.critical,
  }), empty.totals);
  return { departments, totals };
}

// People tab: headcount, vacancies, coverage (out today / upcoming 7d), throughput.
export async function getPeople() {
  const empty = { departments: [], totals: { headcount: 0, vacancies: 0, outToday: 0, upcoming: 0, resolved30: 0 } };
  if (!process.env.DATABASE_URL) return empty;
  let tree;
  try { tree = await loadNodeTree(); } catch (e) { console.warn('[cc-agg getPeople]', e.message); return empty; }
  const { resolveRoot, roots } = tree;
  if (!roots.length) return empty;

  const { head, vac } = await headcountVacancyByRoot(resolveRoot);
  const hh = await hrHubStatsByRoot(resolveRoot);
  const leaveFold = (clause) => foldByRoot(
    `SELECT tmo.org_node_id, COUNT(DISTINCT LOWER(t.work_email))::int AS c
       FROM time_off_events t JOIN team_member_overrides tmo ON LOWER(tmo.email) = LOWER(t.work_email)
      WHERE t.status = 'approved' AND ${clause}
        AND tmo.org_node_id IS NOT NULL AND (tmo.is_deleted IS NULL OR tmo.is_deleted = false)
      GROUP BY tmo.org_node_id`,
    resolveRoot, r => ({ nodeId: r.org_node_id, values: { c: r.c } }),
  );
  const outToday = await leaveFold(`t.start_date <= CURRENT_DATE AND t.end_date >= CURRENT_DATE`);
  const upcoming = await leaveFold(`t.start_date > CURRENT_DATE AND t.start_date <= CURRENT_DATE + INTERVAL '7 days'`);

  const departments = roots.map(d => {
    const headcount = (head.get(d.id) || {}).headcount || 0;
    const vacancies = (vac.get(d.id) || {}).vacancies || 0;
    const out = (outToday.get(d.id) || {}).c || 0;
    const up = (upcoming.get(d.id) || {}).c || 0;
    const resolved30 = (hh.get(d.id) || {}).resolved30 || 0;
    return { id: d.id, name: d.name, slug: d.slug, color: d.color, headcount, vacancies, outToday: out, upcoming: up, resolved30,
      coverage: headcount > 0 ? Math.round((1 - out / headcount) * 100) : 100 };
  }).sort((a, b) => b.headcount - a.headcount);

  const totals = departments.reduce((t, d) => ({
    headcount: t.headcount + d.headcount, vacancies: t.vacancies + d.vacancies,
    outToday: t.outToday + d.outToday, upcoming: t.upcoming + d.upcoming, resolved30: t.resolved30 + d.resolved30,
  }), empty.totals);
  return { departments, totals };
}

// Capacity tab: internal load proxy = open HR Hub work per person, banded. The
// detailed capacity model (Kristina's) lives in each dept's Leaders Hub; the CC
// shows the cross-dept load signal WITHOUT triggering N live external scans.
export async function getCapacity() {
  const empty = { departments: [], totals: { open: 0, headcount: 0, loadPerPerson: 0 } };
  if (!process.env.DATABASE_URL) return empty;
  let tree;
  try { tree = await loadNodeTree(); } catch (e) { console.warn('[cc-agg getCapacity]', e.message); return empty; }
  const { resolveRoot, roots } = tree;
  if (!roots.length) return empty;

  const settings = await getCommandCenterSettings();
  const hh = await hrHubStatsByRoot(resolveRoot, { breachDays: settings.slaBreachDays, atRiskDays: settings.slaAtRiskDays });
  const { head } = await headcountVacancyByRoot(resolveRoot);
  const bandOf = (lpp) => (lpp >= settings.capacityHigh ? 'high' : lpp >= settings.capacityGood ? 'good' : 'low');

  const departments = roots.map(d => {
    const open = (hh.get(d.id) || {}).open || 0;
    const headcount = (head.get(d.id) || {}).headcount || 0;
    const lpp = headcount > 0 ? Math.round((open / headcount) * 10) / 10 : 0;
    return { id: d.id, name: d.name, slug: d.slug, color: d.color, open, headcount, loadPerPerson: lpp, band: bandOf(lpp) };
  }).sort((a, b) => b.loadPerPerson - a.loadPerPerson);

  const tOpen = departments.reduce((t, d) => t + d.open, 0);
  const tHead = departments.reduce((t, d) => t + d.headcount, 0);
  return { departments, totals: { open: tOpen, headcount: tHead, loadPerPerson: tHead > 0 ? Math.round((tOpen / tHead) * 10) / 10 : 0 } };
}

// Summary tab (Controls): one combined per-department row across every domain —
// powers the side-by-side comparison table + the executive CSV export.
export async function getSummary() {
  const empty = { departments: [] };
  if (!process.env.DATABASE_URL) return empty;
  let tree;
  try { tree = await loadNodeTree(); } catch (e) { console.warn('[cc-agg getSummary]', e.message); return empty; }
  const { resolveRoot, roots } = tree;
  if (!roots.length) return empty;

  const settings = await getCommandCenterSettings();
  const hh = await hrHubStatsByRoot(resolveRoot, { breachDays: settings.slaBreachDays, atRiskDays: settings.slaAtRiskDays });
  const { head, vac } = await headcountVacancyByRoot(resolveRoot);
  const outToday = await foldByRoot(
    `SELECT tmo.org_node_id, COUNT(DISTINCT LOWER(t.work_email))::int AS c
       FROM time_off_events t JOIN team_member_overrides tmo ON LOWER(tmo.email) = LOWER(t.work_email)
      WHERE t.status = 'approved' AND t.start_date <= CURRENT_DATE AND t.end_date >= CURRENT_DATE
        AND tmo.org_node_id IS NOT NULL AND (tmo.is_deleted IS NULL OR tmo.is_deleted = false)
      GROUP BY tmo.org_node_id`,
    resolveRoot, r => ({ nodeId: r.org_node_id, values: { c: r.c } }),
  );
  const alerts = await foldByRoot(
    `SELECT org_node_id, COUNT(*) FILTER (WHERE status <> 'resolved')::int AS open_c,
            COUNT(*) FILTER (WHERE status <> 'resolved' AND severity IN ('critical','high'))::int AS crit_c
       FROM leader_alert WHERE org_node_id IS NOT NULL GROUP BY org_node_id`,
    resolveRoot, r => ({ nodeId: r.org_node_id, values: { open: r.open_c, crit: r.crit_c } }),
  );
  const urgent = await foldByRoot(
    `SELECT org_node_id, COUNT(*) FILTER (WHERE status <> 'resolved')::int AS open_c,
            COUNT(*) FILTER (WHERE status <> 'resolved' AND priority IN ('critical','high'))::int AS crit_c
       FROM urgent_assist_request WHERE org_node_id IS NOT NULL GROUP BY org_node_id`,
    resolveRoot, r => ({ nodeId: r.org_node_id, values: { open: r.open_c, crit: r.crit_c } }),
  );

  const departments = roots.map(d => {
    const s = { ...(hh.get(d.id) || {}), headcount: (head.get(d.id) || {}).headcount || 0, vacancies: (vac.get(d.id) || {}).vacancies || 0 };
    const h = healthFromStats(s, settings.healthWeights);
    const a = alerts.get(d.id) || {}, u = urgent.get(d.id) || {};
    return {
      id: d.id, name: d.name, slug: d.slug, health: h.score,
      open: s.open || 0, breached: s.breached || 0, urgent: s.urgent || 0,
      headcount: s.headcount, vacancies: s.vacancies, outToday: (outToday.get(d.id) || {}).c || 0,
      riskOpen: (a.open || 0) + (u.open || 0), riskCritical: (a.crit || 0) + (u.crit || 0),
    };
  }).sort((a, b) => a.health - b.health);
  return { departments };
}

// Self-audit / coverage (adaptability): reconciles the live departments + their
// enabled per-dept sources (dept-integrations) + the Source Registry against
// what the Command Center actually rolls up — so a super-admin can see, at a
// glance, that nothing has gone missing or stale as departments / sources change.
//   • Every live top-level dept is enumerated (so all are "represented").
//   • A dept's enabled Deel/queue sources are surfaced as "tracked per-dept"
//     (the CC shows the internal-data rollup; queue SLA stays in each queue).
//   • Depts with no members are flagged as "needs setup".
export async function getCoverage() {
  const empty = { departments: [], sources: [], summary: {} };
  if (!process.env.DATABASE_URL) return empty;
  let tree;
  try { tree = await loadNodeTree(); } catch (e) { console.warn('[cc-agg getCoverage]', e.message); return empty; }
  const { resolveRoot, roots } = tree;
  if (!roots.length) return empty;

  const { head } = await headcountVacancyByRoot(resolveRoot);
  const departments = roots.map(d => {
    const headcount = (head.get(d.id) || {}).headcount || 0;
    let enabled = {};
    try { enabled = visibleDeelSourcesFor(d.slug) || {}; } catch { enabled = {}; }
    const perDeptSources = Object.entries(enabled).filter(([, v]) => v === true).map(([k]) => k);
    return { id: d.id, name: d.name, slug: d.slug, headcount, perDeptSources, noMembers: headcount === 0 };
  });

  // Registry: domains rolled up cross-dept (internal) vs per-dept-only (external/queue).
  const sources = COMMAND_CENTER_SOURCES.map(s => ({
    key: s.key, label: s.label, deptDimension: s.deptDimension,
    rolledUp: s.deptDimension !== 'dept-integrations',
  }));

  const summary = {
    departmentCount: departments.length,
    departmentsRepresented: departments.length, // all live depts are enumerated live
    departmentsNeedingSetup: departments.filter(d => d.noMembers).length,
    rolledUpSourceCount: sources.filter(s => s.rolledUp).length,
    perDeptOnlySourceCount: sources.filter(s => !s.rolledUp).length,
  };
  return { departments, sources, summary };
}

// Executive CSV export of the summary. RFC-4180 hardened (skill §3.15): UTF-8
// BOM so Excel reads accents, CRLF line endings, every field quoted.
export function summaryToCsv(summary) {
  const departments = summary?.departments || [];
  const headers = ['Department', 'Health', 'Open HR Hub', 'Breached (>7d)', 'Urgent', 'Headcount', 'Vacancies', 'Out today', 'Risk open', 'Risk critical'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(q).join(',')];
  for (const d of departments) {
    lines.push([d.name, d.health, d.open, d.breached, d.urgent, d.headcount, d.vacancies, d.outToday, d.riskOpen, d.riskCritical].map(q).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

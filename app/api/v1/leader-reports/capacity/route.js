// ── /api/v1/leader-reports/capacity (Phases 0-3 — 2026-06-01) ─────────────
// Backs the Leaders Hub → Capacity sub-tab. Single GET response carries:
//   • settings — per-dept formula tuning (defaults synthesized when no
//     row exists in capacity_settings).
//   • countryWorkload — Phase 1: per-country live demand counts from
//     every visible Deel source for the caller's dept + owners derived
//     from team_member_countries.
//   • membersCurrent + membersLeads — Phase 2: per-member load + the
//     team-lead lookup table for FE section headers.
//   • teamSummary — Phase 3: per-Team-Lead roll-up derived from the
//     member rows so the two views can't drift apart.
//   • workloadCachedAt — when the in-process aggregator cache last
//     hydrated (FE surfaces "Snapshot from HH:MM").
//
// Auth: manager+ tier (team_lead, regional_manager, manager, admin).
// Agents get 403 — matches the Leaders Hub Reports sub-tab gate.
//
// Tenancy: every read scopes to getCurrentDeptSlugAndId(user, req) — both
// fields are needed (dept id for DB filters, dept slug for the per-dept
// integration profile that decides which Deel sources to fan out to).
// Super-admin dept switch via the topnav cookie picker re-targets this
// route without a reload (useCurrentDept's instant-switch refactor).
//
// ?bustCache=1 — manual refresh button bypasses the aggregator's 15-min
// in-process cache for one call. Cache is per dept so HRX and GIX
// refreshes don't trample each other.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getCurrentDeptSlugAndId } from '../../../../../src/lib/dept-scope';
import { aggregateCountryWorkload, aggregateMemberLoad, aggregateTeamSummary } from '../../../../../src/lib/capacity-aggregator';

const DEFAULT_SETTINGS = Object.freeze({
  workingDays: 22,
  minutesPerTask: 15,
  minutesPerCall: 15,
  baselineCallHrs: 2.47,
  thresholdOk: 5.5,
  thresholdModerate: 7.0,
  thresholdElevated: 8.0,
});

const MANAGER_ROLES = new Set(['team_lead', 'regional_manager', 'manager', 'admin']);

async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  const { query } = await import('../../../../../src/lib/db');
  return { query };
}

async function loadSettings(query, deptId) {
  const { rows } = await query(
    `SELECT working_days, minutes_per_task, minutes_per_call,
            baseline_call_hrs, threshold_ok, threshold_moderate,
            threshold_elevated, updated_at, updated_by
       FROM capacity_settings
      WHERE org_node_id = $1`,
    [deptId],
  );
  if (rows.length === 0) {
    return { ...DEFAULT_SETTINGS, updatedAt: null, updatedBy: null };
  }
  const r = rows[0];
  return {
    workingDays: r.working_days,
    minutesPerTask: r.minutes_per_task,
    minutesPerCall: r.minutes_per_call,
    baselineCallHrs: Number(r.baseline_call_hrs),
    thresholdOk: Number(r.threshold_ok),
    thresholdModerate: Number(r.threshold_moderate),
    thresholdElevated: Number(r.threshold_elevated),
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.has(String(user.role || '').toLowerCase())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const deptInfo = await getCurrentDeptSlugAndId(user, req);
  if (!deptInfo?.deptId) {
    return NextResponse.json({ error: 'No active department for caller' }, { status: 400 });
  }
  const { deptId, deptSlug } = deptInfo;

  const { searchParams } = new URL(req.url);
  const bustCache = searchParams.get('bustCache') === '1';

  const db = await getDb();
  let settings = { ...DEFAULT_SETTINGS, updatedAt: null, updatedBy: null };
  if (db) {
    try { settings = await loadSettings(db.query, deptId); }
    catch (err) { console.warn('[capacity GET] settings load failed:', err?.message); }
  }

  // Phase 1 (country workload) + Phase 2 (per-member load). Team summary
  // (Phase 3) intentionally still empty.
  let workload = { rows: [], cachedAt: null };
  try {
    workload = await aggregateCountryWorkload({ deptId, deptSlug, bustCache });
  } catch (err) {
    console.warn('[capacity GET] country aggregator failed:', err?.message);
  }

  let memberLoad = { members: [], leads: {} };
  try {
    memberLoad = await aggregateMemberLoad({
      deptId,
      countryWorkload: workload.rows,
      settings,
    });
  } catch (err) {
    console.warn('[capacity GET] member aggregator failed:', err?.message);
  }

  // Phase 3: derive Team Summary entirely from the member roll-up. Single
  // synchronous pass — no extra DB round-trips, guarantees the team
  // numbers and the per-member numbers can't drift apart.
  let teamSummary = { teams: [] };
  try {
    teamSummary = aggregateTeamSummary({
      members: memberLoad.members,
      leads: memberLoad.leads,
      settings,
    });
  } catch (err) {
    console.warn('[capacity GET] team summary failed:', err?.message);
  }

  return NextResponse.json({
    deptId,
    deptSlug,
    settings,
    countryWorkload: workload.rows,
    workloadCachedAt: workload.cachedAt,
    membersCurrent: memberLoad.members,
    membersLeads: memberLoad.leads,
    teamSummary: teamSummary.teams,
  });
}

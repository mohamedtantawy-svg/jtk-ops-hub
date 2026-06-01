// ── /api/v1/leader-reports/capacity (Phase 0 — 2026-06-01) ────────────────
// Skeleton endpoint that backs the Leaders Hub → Capacity sub-tab. Returns
// the per-dept settings row (creating defaults on first read) and a
// placeholder empty payload for countryWorkload / membersCurrent /
// teamSummary — those land in Phases 1/2/3.
//
// Auth: manager+ tier (team_lead, regional_manager, manager, admin).
// Agents get 403 — matches the Leaders Hub Reports sub-tab gate.
//
// Tenancy: every read scopes to getCurrentDeptId(user, req). Super-admin
// dept switch via the topnav cookie picker re-targets this route without
// a reload (useCurrentDept's instant-switch refactor).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';

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

  const deptId = await getCurrentDeptId(user, req);
  if (!deptId) {
    return NextResponse.json({ error: 'No active department for caller' }, { status: 400 });
  }

  const db = await getDb();
  let settings = { ...DEFAULT_SETTINGS, updatedAt: null, updatedBy: null };
  if (db) {
    try { settings = await loadSettings(db.query, deptId); }
    catch (err) { console.warn('[capacity GET] settings load failed:', err?.message); }
  }

  // Phase 0 returns the shell. Phases 1/2/3 populate these arrays.
  return NextResponse.json({
    deptId,
    settings,
    countryWorkload: [],
    membersCurrent: [],
    teamSummary: [],
  });
}

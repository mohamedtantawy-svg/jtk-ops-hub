// ── /api/v1/leader-reports/productivity (2026-06-01) ──────────────────────
// Backs the Leaders Hub → Reports → Productivity surface. Sarah Suge's
// feedback: "no centralized way to track team productivity — view tasks
// solved per team per category over a selected time period (weekly,
// monthly, or custom)".
//
// Query params:
//   • period — '7d' | '30d' | '90d' | 'custom'    (default: 7d)
//   • start  — YYYY-MM-DD                          (required if period=custom)
//   • end    — YYYY-MM-DD                          (required if period=custom;
//                                                   exclusive — the bucket
//                                                   `end` itself is NOT counted)
//   • bustCache — '1' to bypass the 5-min in-process cache.
//
// Auth: manager+ tier. Agents 403 (matches the Reports sub-tab gate).
// Tenancy: every read scopes via getCurrentDeptId + the dept sub-tree
// CTE inside the aggregator; super-admin dept switch re-targets without
// reload (useCurrentDept's instant-switch).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';
import { aggregateProductivity, CATEGORIES } from '../../../../../src/lib/productivity-aggregator';

const MANAGER_ROLES = new Set(['team_lead', 'regional_manager', 'manager', 'admin']);

// Format a JS Date as YYYY-MM-DD against UTC.
function isoDay(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function presetRange(preset) {
  // `end` is the day AFTER today's UTC midnight so today's resolutions
  // are included (the aggregator's range is `start <= resolved_at < end`).
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  if (preset === '30d')      start.setUTCDate(start.getUTCDate() - 30);
  else if (preset === '90d') start.setUTCDate(start.getUTCDate() - 90);
  else                       start.setUTCDate(start.getUTCDate() - 7);   // default 7d
  return { start: isoDay(start), end: isoDay(end) };
}

function validDateString(s) {
  if (!s || typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isFinite(d.getTime());
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

  const { searchParams } = new URL(req.url);
  const period    = (searchParams.get('period') || '7d').toLowerCase();
  const bustCache = searchParams.get('bustCache') === '1';

  let start, end, label;
  if (period === 'custom') {
    const s = searchParams.get('start');
    const e = searchParams.get('end');
    if (!validDateString(s) || !validDateString(e)) {
      return NextResponse.json(
        { error: 'Custom period requires start + end as YYYY-MM-DD' },
        { status: 400 },
      );
    }
    if (s >= e) {
      return NextResponse.json(
        { error: 'Custom period: start must be earlier than end' },
        { status: 400 },
      );
    }
    start = s;
    end = e;
    label = 'Custom';
  } else if (['7d', '30d', '90d'].includes(period)) {
    const r = presetRange(period);
    start = r.start;
    end = r.end;
    label =
      period === '30d' ? 'Last 30 days' :
      period === '90d' ? 'Last 90 days' : 'Last 7 days';
  } else {
    return NextResponse.json({ error: 'Invalid period — use 7d, 30d, 90d, or custom' }, { status: 400 });
  }

  let data;
  try {
    data = await aggregateProductivity({ deptId, start, end, bustCache });
  } catch (err) {
    console.error('[productivity GET] aggregator failed:', err?.message);
    return NextResponse.json({ error: 'Aggregator failed' }, { status: 500 });
  }

  return NextResponse.json({
    deptId,
    period: { id: period, label, start, end },
    categories: CATEGORIES,    // surface labels + colours so the FE has one source of truth
    ...data,
  });
}

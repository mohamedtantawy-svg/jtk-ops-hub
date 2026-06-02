// ── /api/v1/command-center/overview (Phase 0 — 2026-06-03) ──────────────────
// Executive Command Center landing payload: the LIVE department roster (from
// org_nodes, so it adapts automatically when departments change) + org-wide
// totals. Metric rollups (health, SLA, volume, …) layer on in later phases.
//
// SECURITY: the Command Center aggregates EVERY department — the inverse of the
// per-dept isolation every other route enforces. So this route is gated to exec
// viewers ONLY via canViewCommandCenter() (super-admin / seeded leadership
// roster / full admin / per-user is_command_center_viewer grant). Regional
// Managers and below get 403. Never trust the FE — this is the security
// boundary, kept in lockstep with the FE perms.canViewCommandCenter.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { getOverview } from '../../../../../src/lib/command-center-aggregator';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const data = await getOverview();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[command-center/overview]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

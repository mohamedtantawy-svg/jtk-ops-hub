// ── /api/v1/command-center/coverage ──────────────────────────────────────────
// Self-audit: live departments + their enabled per-dept sources + the Source
// Registry reconciled against what the Command Center rolls up. Exec-gated.
// Surfaces adaptability gaps (new depts, per-dept-only sources) so nothing goes
// missing or stale as the org changes.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { getCoverage } from '../../../../../src/lib/command-center-aggregator';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getCoverage());
  } catch (err) {
    console.error('[command-center/coverage]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

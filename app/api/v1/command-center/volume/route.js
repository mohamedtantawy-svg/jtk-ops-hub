// ── /api/v1/command-center/volume ────────────────────────────────────────────
// Org-wide 30-day created-vs-resolved daily series + per-department totals.
// Exec-gated. Internal HR Hub flow (created_at / resolved_at).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { getVolume } from '../../../../../src/lib/command-center-aggregator';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getVolume());
  } catch (err) {
    console.error('[command-center/volume]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

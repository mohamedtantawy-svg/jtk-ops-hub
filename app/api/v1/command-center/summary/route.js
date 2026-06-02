// ── /api/v1/command-center/summary ───────────────────────────────────────────
// One combined per-department row across every domain — powers the Controls
// comparison table. Exec-gated cross-department rollup.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { getSummary } from '../../../../../src/lib/command-center-aggregator';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getSummary());
  } catch (err) {
    console.error('[command-center/summary]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

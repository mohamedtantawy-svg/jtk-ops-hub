// ── /api/v1/command-center/people ────────────────────────────────────────────
// Headcount, vacancies, coverage (out today / upcoming 7d), throughput per dept.
// Exec-gated cross-department rollup. Internal tables.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { getPeople } from '../../../../../src/lib/command-center-aggregator';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getPeople());
  } catch (err) {
    console.error('[command-center/people]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

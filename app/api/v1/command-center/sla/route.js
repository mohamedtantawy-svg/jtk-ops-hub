// ── /api/v1/command-center/sla ───────────────────────────────────────────────
// Cross-department HR Hub ageing (fresh / at-risk / breached) + urgent, per dept.
// Exec-gated. Internal HR Hub signal; queue/Deel SLA stays per-dept (deep-link).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { getSla } from '../../../../../src/lib/command-center-aggregator';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getSla());
  } catch (err) {
    console.error('[command-center/sla]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

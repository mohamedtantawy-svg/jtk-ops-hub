// ── /api/v1/command-center/capacity ──────────────────────────────────────────
// Cross-department load proxy: open HR Hub work per person, banded. Exec-gated.
// Internal-only (the detailed per-dept capacity model lives in Leaders Hub).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { getCapacity } from '../../../../../src/lib/command-center-aggregator';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getCapacity());
  } catch (err) {
    console.error('[command-center/capacity]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

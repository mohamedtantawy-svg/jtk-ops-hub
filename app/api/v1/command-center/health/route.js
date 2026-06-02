// ── /api/v1/command-center/health ───────────────────────────────────────────
// Per-department composite Health Score + component breakdown + org-wide roll-up.
// Exec-gated (super-admin OR effective dept === Command Center). Cross-department
// rollup — the inverse of per-dept isolation; never trust the FE.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { getHealth } from '../../../../../src/lib/command-center-aggregator';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getHealth());
  } catch (err) {
    console.error('[command-center/health]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

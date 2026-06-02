// ── /api/v1/command-center/risk ──────────────────────────────────────────────
// Open Leader Alerts / Urgent Assists / Escalations per department (+ critical).
// Exec-gated cross-department rollup. Internal org_node_id tables.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { getRisk } from '../../../../../src/lib/command-center-aggregator';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getRisk());
  } catch (err) {
    console.error('[command-center/risk]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

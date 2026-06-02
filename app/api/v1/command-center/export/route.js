// ── /api/v1/command-center/export ─────────────────────────────────────────────
// Executive CSV export of the cross-department summary. Exec-gated. RFC-4180
// hardened (UTF-8 BOM + CRLF + always-quote, skill §3.15) with an ASCII-safe
// filename so Safari keeps the Content-Disposition header.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { getSummary, summaryToCsv } from '../../../../../src/lib/command-center-aggregator';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const csv = summaryToCsv(await getSummary());
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="command-center-summary.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[command-center/export]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

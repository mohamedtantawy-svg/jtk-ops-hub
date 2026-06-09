// ── /api/v1/performance/reminders ────────────────────────────────────────────
// Lightweight count for the home-page reminder cards + the nav badge.
// GET → { month, year, managerDue, memberPending, count } for the caller:
//   • managerDue   — how many of the caller's reports lack a FINALIZED review
//                    for the current month (managers/perf-admin only).
//   • memberPending — 1 if the caller's own current-month review awaits their
//                    reflection (member_input) or acknowledgment (finalized).
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import { directReportEmails } from '../../../../../src/lib/performance-helpers';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();
  try {
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const me = user.email.toLowerCase();

    // A manager reviews their DIRECT reports; managerDue = direct reports
    // without a finalized/acknowledged review for the current month.
    let managerDue = 0;
    const reports = directReportEmails(me).filter(e => e && e !== me);
    if (reports.length > 0) {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM perf_reviews
          WHERE LOWER(member_email) = ANY($1::text[]) AND period_month = $2 AND period_year = $3
            AND status IN ('finalized','acknowledged')`,
        [reports, month, year]);
      managerDue = Math.max(0, reports.length - (rows[0]?.n || 0));
    }

    let memberPending = 0;
    const { rows: own } = await query(
      `SELECT status FROM perf_reviews WHERE LOWER(member_email) = $1 AND period_month = $2 AND period_year = $3 LIMIT 1`,
      [me, month, year]);
    const st = own[0]?.status;
    if (st === 'member_input' || st === 'finalized') memberPending = 1;

    return NextResponse.json({ month, year, managerDue, memberPending, count: managerDue + memberPending });
  } catch (err) {
    console.error('[performance/reminders GET]', err.message);
    return NextResponse.json({ month: null, year: null, managerDue: 0, memberPending: 0, count: 0 });
  }
}

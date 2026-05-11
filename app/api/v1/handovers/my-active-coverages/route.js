// ── GET /api/v1/handovers/my-active-coverages ─────────────────────────
// Phase 3 of HANDOVERS_PLAN.md. Returns the caller's currently-merged
// coverages: handovers where the caller is listed as an accepted
// coverer AND the handover is in `approved` or `active` status AND
// today is within the date window. Powers the Briefing Coverage banner
// + card so users see at a glance "you are covering N people right
// now".

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { MEMBERS_BY_EMAIL } from '../../../../../src/data/members';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const callerEmail = user.email.toLowerCase();

  try {
    const { rows } = await query(
      `SELECT h.id AS handover_id,
              h.requester_email,
              h.start_date,
              h.end_date,
              h.status,
              hc.country_codes
         FROM handover_coverers hc
         JOIN handovers h ON h.id = hc.handover_id
        WHERE LOWER(hc.coverer_email) = $1
          AND hc.acceptance_status = 'accepted'
          AND h.status IN ('approved','active')
          AND h.start_date <= CURRENT_DATE
          AND h.end_date   >= CURRENT_DATE
        ORDER BY h.start_date ASC`,
      [callerEmail],
    );

    const items = rows.map(r => {
      const m = MEMBERS_BY_EMAIL[(r.requester_email || '').toLowerCase()] || null;
      const start = r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : r.start_date;
      const end   = r.end_date   instanceof Date ? r.end_date.toISOString().slice(0, 10)   : r.end_date;
      return {
        handover_id: r.handover_id,
        requester_email: r.requester_email,
        requester_name: m?.name || r.requester_email,
        start_date: start,
        end_date: end,
        status: r.status,
        country_codes: Array.isArray(r.country_codes) ? r.country_codes : [],
      };
    });

    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    console.error('[handovers/my-active-coverages]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

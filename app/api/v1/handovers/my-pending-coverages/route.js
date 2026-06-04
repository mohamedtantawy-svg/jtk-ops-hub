// ── GET /api/v1/handovers/my-pending-coverages ────────────────────────
// Coverage invitations awaiting the caller's response: handovers where the
// caller is listed as a coverer whose acceptance_status is still 'pending'
// AND the handover sits in 'pending_coverage_acceptance'. Powers the
// home-page "Coverage requests need your response" banner + the accept/
// decline popup (Mohamed 2026-06-04 — "when an OOO coverage is requested
// the assignee should get a popup to accept or reject, and it needs to
// show on the home page"). Sibling of my-active-coverages (which returns
// already-ACCEPTED, in-window coverages).
//
// No date-window filter on purpose: an invitation is almost always for an
// UPCOMING window, so restricting to today would hide every pending ask.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { MEMBERS_BY_EMAIL } from '../../../../../src/data/members';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Hydrate so requester_name resolves for members added since pod boot
  // (same reason as my-active-coverages).
  await ensureRosterHydrated();
  const callerEmail = user.email.toLowerCase();

  try {
    const { rows } = await query(
      `SELECT h.id AS handover_id,
              h.requester_email,
              h.start_date,
              h.end_date,
              h.status,
              h.reason,
              hc.country_codes,
              hc.invited_at
         FROM handover_coverers hc
         JOIN handovers h ON h.id = hc.handover_id
        WHERE LOWER(hc.coverer_email) = $1
          AND hc.acceptance_status = 'pending'
          AND h.status = 'pending_coverage_acceptance'
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
        reason: r.reason || null,
        country_codes: Array.isArray(r.country_codes) ? r.country_codes : [],
      };
    });

    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    console.error('[handovers/my-pending-coverages]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

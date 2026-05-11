// ── GET /api/v1/time-off-events/me ─────────────────────────────────────
// Convenience wrapper around the caller's own time-off events. Used by
// the OOO action banner ("You have N upcoming OOO without a handover")
// and the Mine lens default-fetch on first paint. Equivalent to
// GET /api/v1/time-off-events?lens=mine but skips the visibility filter
// build since we already know the answer.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const fromRaw = url.searchParams.get('from');
  const from = fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : null;

  const params = [user.email.toLowerCase()];
  const fromClause = from ? `AND e.end_date >= $2` : '';
  if (from) params.push(from);

  try {
    const { rows } = await query(
      `SELECT
         e.id, e.work_email, e.start_date, e.end_date, e.source, e.status, e.reason,
         h.id            AS handover_id,
         h.status        AS handover_status,
         h.submitted_at  AS handover_submitted_at
       FROM time_off_events e
       LEFT JOIN LATERAL (
         SELECT id, status, submitted_at FROM handovers h2
          WHERE h2.time_off_event_id = e.id
            AND h2.status NOT IN ('cancelled','rejected','expired')
          ORDER BY h2.created_at DESC LIMIT 1
       ) h ON TRUE
       WHERE LOWER(e.work_email) = $1
         AND e.status = 'approved'
         ${fromClause}
       ORDER BY e.start_date ASC`,
      params,
    );

    const items = rows.map(r => ({
      id: r.id,
      work_email: r.work_email,
      start_date: r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : r.start_date,
      end_date:   r.end_date   instanceof Date ? r.end_date.toISOString().slice(0, 10)   : r.end_date,
      source: r.source,
      status: r.status,
      reason: r.reason,
      handover: r.handover_id ? {
        id: r.handover_id,
        status: r.handover_status,
        submitted_at: r.handover_submitted_at,
      } : null,
    }));

    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    console.error('[time-off-events/me GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

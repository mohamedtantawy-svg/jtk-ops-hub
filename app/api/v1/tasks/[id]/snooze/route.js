import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

export async function PATCH(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { until } = await req.json();

    if (until) {
      const untilDate = new Date(until);
      if (isNaN(untilDate.getTime())) {
        return NextResponse.json({ error: 'Invalid date format for until' }, { status: 400 });
      }
      if (untilDate <= new Date()) {
        return NextResponse.json({ error: 'Snooze date must be in the future' }, { status: 400 });
      }
    }

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const whereClause = isUUID ? 'WHERE id = $2' : 'WHERE external_id = $2';

    const { rows } = await query(
      `UPDATE tasks SET snoozed_until = $1, status = 'snoozed', updated_at = NOW() ${whereClause} RETURNING *`,
      [until || null, id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true, snoozedUntil: rows[0].snoozed_until });
  } catch (err) {
    console.error('[tasks/snooze]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

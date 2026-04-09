import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const { until } = await req.json();

    const { rows } = await query(
      'UPDATE tasks SET snoozed_until = $1, status = \'snoozed\', updated_at = NOW() WHERE id = $2 OR external_id = $2 RETURNING *',
      [until || null, id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true, snoozedUntil: rows[0].snoozed_until });
  } catch (err) {
    console.error('[tasks/snooze]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

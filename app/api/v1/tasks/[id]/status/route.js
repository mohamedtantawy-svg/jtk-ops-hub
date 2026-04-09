import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const { status } = await req.json();
    if (!status) return NextResponse.json({ error: 'Status required' }, { status: 400 });

    const { rows } = await query(
      'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 OR external_id = $2 RETURNING *',
      [status, id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Log activity
    await query(
      'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
      [rows[0].id, 'status', `Status changed to ${status}`, 'System']
    );

    return NextResponse.json({ ok: true, status: rows[0].status });
  } catch (err) {
    console.error('[tasks/status]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

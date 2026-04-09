import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const { assigneeId } = await req.json();

    const { rows } = await query(
      'UPDATE tasks SET assignee_id = $1, status = CASE WHEN status = \'open\' THEN \'in_progress\' ELSE status END, updated_at = NOW() WHERE id = $2 OR external_id = $2 RETURNING *',
      [assigneeId || null, id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await query(
      'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
      [rows[0].id, 'assign', `Assigned to member ${assigneeId}`, 'System']
    );

    return NextResponse.json({ ok: true, assigneeId: rows[0].assignee_id });
  } catch (err) {
    console.error('[tasks/assign]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

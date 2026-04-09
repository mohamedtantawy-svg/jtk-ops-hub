import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const task = await query('SELECT id FROM tasks WHERE id = $1 OR external_id = $1', [id]);
    if (task.rows.length === 0) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const { rows } = await query(
      'SELECT * FROM task_activity WHERE task_id = $1 ORDER BY occurred_at DESC',
      [task.rows[0].id]
    );

    const items = rows.map(r => ({
      id: r.id, eventType: r.event_type, eventText: r.event_text,
      actorName: r.actor_name, occurredAt: r.occurred_at,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[activity GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

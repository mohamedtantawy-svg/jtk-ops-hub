import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const taskWhereClause = isUUID ? 'WHERE id = $1' : 'WHERE external_id = $1';
    const task = await query(`SELECT id FROM tasks ${taskWhereClause}`, [id]);
    if (task.rows.length === 0) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const taskId = task.rows[0].id;

    const [{ rows }, countResult] = await Promise.all([
      query(
        'SELECT id, event_type, event_text, actor_name, occurred_at FROM task_activity WHERE task_id = $1 ORDER BY occurred_at DESC LIMIT $2 OFFSET $3',
        [taskId, limit, offset]
      ),
      query('SELECT COUNT(*) FROM task_activity WHERE task_id = $1', [taskId]),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    const items = rows.map(r => ({
      id: r.id, eventType: r.event_type, eventText: r.event_text,
      actorName: r.actor_name, occurredAt: r.occurred_at,
    }));

    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[activity GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

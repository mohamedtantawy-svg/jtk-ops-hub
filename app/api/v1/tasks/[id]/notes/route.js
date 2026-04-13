import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    // Resolve task UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const taskWhereClause = isUUID ? 'WHERE id = $1' : 'WHERE external_id = $1';
    const task = await query(`SELECT id FROM tasks ${taskWhereClause}`, [id]);
    if (task.rows.length === 0) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const taskId = task.rows[0].id;

    const [{ rows }, countResult] = await Promise.all([
      query(
        'SELECT id, body, author_id, author_name, is_internal, created_at FROM task_notes WHERE task_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
        [taskId, limit, offset]
      ),
      query('SELECT COUNT(*) FROM task_notes WHERE task_id = $1', [taskId]),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    const items = rows.map(r => ({
      id: r.id, body: r.body, authorId: r.author_id, authorName: r.author_name,
      isInternal: r.is_internal, createdAt: r.created_at,
    }));

    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[notes GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const authUser = getAuthUser(req);
    const { id } = await params;
    const { body, isInternal } = await req.json();
    if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 });

    const isUUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const postWhereClause = isUUID2 ? 'WHERE id = $1' : 'WHERE external_id = $1';
    const task = await query(`SELECT id FROM tasks ${postWhereClause}`, [id]);
    if (task.rows.length === 0) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const { rows } = await query(
      'INSERT INTO task_notes (task_id, body, is_internal, author_name) VALUES ($1, $2, $3, $4) RETURNING *',
      [task.rows[0].id, body, isInternal || false, authUser.name || 'User']
    );

    const r = rows[0];
    return NextResponse.json({
      id: r.id, body: r.body, authorId: r.author_id, authorName: r.author_name,
      isInternal: r.is_internal, createdAt: r.created_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[notes POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

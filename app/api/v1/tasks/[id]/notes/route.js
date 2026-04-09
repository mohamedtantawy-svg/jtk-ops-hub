import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    // Resolve task UUID
    const task = await query('SELECT id FROM tasks WHERE id = $1 OR external_id = $1', [id]);
    if (task.rows.length === 0) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const { rows } = await query(
      'SELECT * FROM task_notes WHERE task_id = $1 ORDER BY created_at ASC',
      [task.rows[0].id]
    );

    const items = rows.map(r => ({
      id: r.id, body: r.body, authorId: r.author_id, authorName: r.author_name,
      isInternal: r.is_internal, createdAt: r.created_at,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[notes GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const { body, isInternal } = await req.json();
    if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 });

    const task = await query('SELECT id FROM tasks WHERE id = $1 OR external_id = $1', [id]);
    if (task.rows.length === 0) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const { rows } = await query(
      'INSERT INTO task_notes (task_id, body, is_internal, author_name) VALUES ($1, $2, $3, $4) RETURNING *',
      [task.rows[0].id, body, isInternal || false, 'User']
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

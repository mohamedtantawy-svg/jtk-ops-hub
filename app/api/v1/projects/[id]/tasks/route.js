import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { rows } = await query(
      `SELECT pt.id AS link_id, pt.created_at AS linked_at,
              t.id, t.subject, t.status, t.priority, t.assignee_id, t.created_at
       FROM project_tasks pt
       JOIN tasks t ON t.id = pt.task_id
       WHERE pt.project_id = $1
       ORDER BY pt.created_at ASC`,
      [id]
    );
    return NextResponse.json(rows.map(r => ({
      linkId: r.link_id,
      linkedAt: r.linked_at,
      id: r.id,
      subject: r.subject,
      status: r.status,
      priority: r.priority,
      assigneeId: r.assignee_id,
      createdAt: r.created_at,
    })));
  } catch (err) {
    console.error('[tasks GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json();
    if (!body.taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }
    const { rows } = await query(
      `INSERT INTO project_tasks (project_id, task_id)
       VALUES ($1, $2) RETURNING *`,
      [id, body.taskId]
    );
    const r = rows[0];
    return NextResponse.json({
      id: r.id,
      projectId: r.project_id,
      taskId: r.task_id,
      createdAt: r.created_at,
    }, { status: 201 });
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'Task already linked' }, { status: 409 });
    }
    console.error('[tasks POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

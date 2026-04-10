import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { rows } = await query(
      'SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC',
      [id]
    );
    return NextResponse.json(rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      dueDate: r.due_date,
      sortOrder: r.sort_order,
      completed: r.completed,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })));
  } catch (err) {
    console.error('[milestones GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json();
    if (!body.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    const { rows } = await query(
      `INSERT INTO project_milestones (project_id, title, due_date, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, body.title, body.dueDate || null, body.sortOrder || 0]
    );
    const r = rows[0];
    return NextResponse.json({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      dueDate: r.due_date,
      sortOrder: r.sort_order,
      completed: r.completed,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[milestones POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

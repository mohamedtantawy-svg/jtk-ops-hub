import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';

export async function PATCH(req, { params }) {
  try {
    const { id, milestoneId } = await params;
    const body = await req.json();
    const allowed = ['title', 'due_date', 'sort_order', 'completed'];
    const sets = [];
    const vals = [];
    let idx = 1;

    for (const [key, val] of Object.entries(body)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowed.includes(col)) {
        sets.push(`${col} = $${idx++}`);
        vals.push(val);
      }
    }

    if (sets.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    sets.push('updated_at = NOW()');
    vals.push(milestoneId, id);

    const { rows } = await query(
      `UPDATE project_milestones SET ${sets.join(', ')} WHERE id = $${idx} AND project_id = $${idx + 1} RETURNING *`,
      vals
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
    });
  } catch (err) {
    console.error('[milestones PATCH]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { id, milestoneId } = await params;
    await query('DELETE FROM project_milestones WHERE id = $1 AND project_id = $2', [milestoneId, id]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[milestones DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

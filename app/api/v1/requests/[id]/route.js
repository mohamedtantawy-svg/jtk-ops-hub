import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { rows } = await query('SELECT * FROM requests WHERE id = $1', [id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const r = rows[0];
    return NextResponse.json({
      id: r.id, subject: r.subject, description: r.description,
      toTeam: r.to_team, status: r.status, priority: r.priority,
      fromMemberId: r.from_member_id, taskId: r.task_id,
      externalRef: r.external_ref, notes: r.notes,
      dueDate: r.due_date, resolvedAt: r.resolved_at,
      createdAt: r.created_at, updatedAt: r.updated_at,
    });
  } catch (err) {
    console.error('[requests/id GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const allowed = ['subject', 'description', 'to_team', 'status', 'priority', 'notes', 'due_date', 'resolved_at'];
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
    vals.push(id);

    const { rows } = await query(
      `UPDATE requests SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[requests/id PATCH]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    await query('DELETE FROM requests WHERE id = $1', [id]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[requests/id DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

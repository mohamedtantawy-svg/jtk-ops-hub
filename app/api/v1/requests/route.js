import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const toTeam = searchParams.get('toTeam');
    const status = searchParams.get('status');
    const fromMember = searchParams.get('fromMember');

    let sql = 'SELECT * FROM requests WHERE 1=1';
    const params = [];
    let idx = 1;

    if (toTeam) { sql += ` AND to_team = $${idx++}`; params.push(toTeam); }
    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }
    if (fromMember) { sql += ` AND from_member_id = $${idx++}`; params.push(fromMember); }

    sql += ' ORDER BY created_at DESC';

    const { rows } = await query(sql, params);

    const items = rows.map(r => ({
      id: r.id, subject: r.subject, description: r.description,
      toTeam: r.to_team, status: r.status, priority: r.priority,
      fromMemberId: r.from_member_id, taskId: r.task_id,
      externalRef: r.external_ref, notes: r.notes,
      dueDate: r.due_date, resolvedAt: r.resolved_at,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[requests GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { subject, description, toTeam, priority, fromMemberId, taskId, externalRef, dueDate } = body;
    if (!subject) return NextResponse.json({ error: 'Subject required' }, { status: 400 });

    const { rows } = await query(
      `INSERT INTO requests (subject, description, to_team, priority, from_member_id, task_id, external_ref, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [subject, description || '', toTeam || null, priority || 'medium', fromMemberId || null, taskId || null, externalRef || null, dueDate || null]
    );

    const r = rows[0];
    return NextResponse.json({
      id: r.id, subject: r.subject, description: r.description,
      toTeam: r.to_team, status: r.status, priority: r.priority,
      fromMemberId: r.from_member_id, createdAt: r.created_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[requests POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

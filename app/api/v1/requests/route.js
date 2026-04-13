import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const toTeam = searchParams.get('toTeam');
    const status = searchParams.get('status');
    const fromMember = searchParams.get('fromMember');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
    const offset = (page - 1) * limit;

    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    if (toTeam) { whereSql += ` AND to_team = $${idx++}`; params.push(toTeam); }
    if (status) { whereSql += ` AND status = $${idx++}`; params.push(status); }
    if (fromMember) { whereSql += ` AND from_member_id = $${idx++}`; params.push(fromMember); }

    const countSql = 'SELECT COUNT(*) FROM requests' + whereSql;
    const dataSql = 'SELECT id, subject, to_team, status, priority, from_member_id, task_id, external_ref, notes, due_date, resolved_at, created_at, updated_at FROM requests' + whereSql + ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const [{ rows }, countResult] = await Promise.all([
      query(dataSql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    const items = rows.map(r => ({
      id: r.id, subject: r.subject,
      toTeam: r.to_team, status: r.status, priority: r.priority,
      fromMemberId: r.from_member_id, taskId: r.task_id,
      externalRef: r.external_ref, notes: r.notes,
      dueDate: r.due_date, resolvedAt: r.resolved_at,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    return NextResponse.json({ items, page, limit, total });
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

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const ownerId = searchParams.get('ownerId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) { whereSql += ` AND status = $${idx++}`; params.push(status); }
    if (priority) { whereSql += ` AND priority = $${idx++}`; params.push(priority); }
    if (ownerId) { whereSql += ` AND owner_id = $${idx++}`; params.push(ownerId); }

    const countSql = 'SELECT COUNT(*) FROM projects' + whereSql;
    const dataSql = 'SELECT id, title, type, status, priority, owner_id, team_id, deadline, progress, created_at, updated_at FROM projects' + whereSql + ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const [{ rows }, countResult] = await Promise.all([
      query(dataSql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    const items = rows.map(r => ({
      id: r.id, title: r.title, name: r.title, type: r.type,
      status: r.status, priority: r.priority, ownerId: r.owner_id,
      teamId: r.team_id, deadline: r.deadline,
      progress: r.progress, createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[projects GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { title, type, status, priority, ownerId, teamId, deadline, description } = body;
    if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 });

    const { rows } = await query(
      `INSERT INTO projects (title, type, status, priority, owner_id, team_id, deadline, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, type || 'general', status || 'active', priority || 'medium', ownerId || null, teamId || null, deadline || null, description || '']
    );

    const r = rows[0];
    return NextResponse.json({
      id: r.id, title: r.title, type: r.type, status: r.status, priority: r.priority,
      ownerId: r.owner_id, teamId: r.team_id, deadline: r.deadline,
      description: r.description, progress: r.progress,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[projects POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

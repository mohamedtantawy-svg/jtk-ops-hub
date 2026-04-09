import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const ownerId = searchParams.get('ownerId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

    let sql = 'SELECT * FROM projects WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }
    if (priority) { sql += ` AND priority = $${idx++}`; params.push(priority); }
    if (ownerId) { sql += ` AND owner_id = $${idx++}`; params.push(ownerId); }

    sql += ` ORDER BY created_at DESC LIMIT $${idx++}`;
    params.push(limit);

    const { rows } = await query(sql, params);

    const items = rows.map(r => ({
      id: r.id, title: r.title, name: r.title, type: r.type,
      status: r.status, priority: r.priority, ownerId: r.owner_id,
      teamId: r.team_id, deadline: r.deadline, description: r.description,
      progress: r.progress, createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    return NextResponse.json({ items });
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

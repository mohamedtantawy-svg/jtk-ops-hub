import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');
    const region = searchParams.get('region');
    const isActive = searchParams.get('isActive');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

    let sql = 'SELECT * FROM members WHERE 1=1';
    const params = [];
    let idx = 1;

    if (role) { sql += ` AND role = $${idx++}`; params.push(role); }
    if (region) { sql += ` AND region = $${idx++}`; params.push(region); }
    if (isActive !== null && isActive !== undefined) { sql += ` AND is_active = $${idx++}`; params.push(isActive === 'true'); }

    sql += ` ORDER BY id ASC LIMIT $${idx++}`;
    params.push(limit);

    const { rows } = await query(sql, params);

    const items = rows.map(r => ({
      id: r.id, name: r.name, initials: r.initials, role: r.role,
      team: r.team, region: r.region, country: r.country,
      leadId: r.lead_id, email: r.email, avatarUrl: r.avatar_url,
      isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[members GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { name, role, team, region, country, leadId, email } = body;
    if (!name || !email) return NextResponse.json({ error: 'Name and email required' }, { status: 400 });

    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

    const { rows } = await query(
      `INSERT INTO members (name, initials, role, team, region, country, lead_id, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, initials, role || 'agent', team || null, region || null, country || null, leadId || null, email.toLowerCase()]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    if (err.code === '23505') return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    console.error('[members POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

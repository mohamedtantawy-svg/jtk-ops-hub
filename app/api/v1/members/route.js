import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { requireRole } from '../../../../src/lib/auth-helpers';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');
    const region = searchParams.get('region');
    const isActive = searchParams.get('isActive');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    if (role) { whereSql += ` AND role = $${idx++}`; params.push(role); }
    if (region) { whereSql += ` AND region = $${idx++}`; params.push(region); }
    if (isActive !== null && isActive !== undefined) { whereSql += ` AND is_active = $${idx++}`; params.push(isActive === 'true'); }

    const countSql = 'SELECT COUNT(*) FROM members' + whereSql;
    const dataSql = 'SELECT id, name, initials, role, team, region, country, lead_id, email, avatar_url, is_active, created_at, updated_at FROM members' + whereSql + ` ORDER BY id ASC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const [{ rows }, countResult] = await Promise.all([
      query(dataSql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    const items = rows.map(r => ({
      id: r.id, name: r.name, initials: r.initials, role: r.role,
      team: r.team, region: r.region, country: r.country,
      leadId: r.lead_id, email: r.email, avatarUrl: r.avatar_url,
      isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[members GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { authorized, user, status, error } = requireRole(req, 'admin', 'manager');
    if (!authorized) return NextResponse.json({ error }, { status });

    const body = await req.json();
    const { name, role, team, region, country, leadId, email } = body;
    if (!name || !email) return NextResponse.json({ error: 'Name and email required' }, { status: 400 });

    // Email format validation
    if (!email.includes('@') || !email.toLowerCase().endsWith('@deel.com')) {
      return NextResponse.json({ error: 'Email must be a valid @deel.com address' }, { status: 400 });
    }

    // Name length limit
    if (name.length > 100) {
      return NextResponse.json({ error: 'Name must be 100 characters or less' }, { status: 400 });
    }

    // Role whitelist validation
    const VALID_ROLES = ['admin', 'manager', 'agent'];
    if (role && !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
    }

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

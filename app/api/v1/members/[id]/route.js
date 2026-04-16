import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';

export async function GET(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { rows } = await query('SELECT * FROM members WHERE id = $1', [id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('[members/id GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();

    // Role changes require admin privileges — prevent privilege escalation
    if (body.role && user.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can change member roles' }, { status: 403 });
    }
    // Deactivation requires admin
    if (body.isActive === false && user.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can deactivate members' }, { status: 403 });
    }

    // Enum validation for constrained fields
    const VALID_ROLES = ['admin', 'regional_manager', 'team_lead', 'agent'];
    if (body.role && !VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
    }

    const allowed = ['name', 'role', 'team', 'region', 'country', 'lead_id', 'avatar_url', 'is_active'];
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

    sets.push(`updated_at = NOW()`);
    vals.push(id);

    const { rows } = await query(
      `UPDATE members SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('[members/id PATCH]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

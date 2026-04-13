import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';

export async function GET(req) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { rows } = await query(
      'SELECT id, name, initials, role, team, region, country, lead_id, email, avatar_url, is_active, created_at, updated_at FROM members WHERE email = $1',
      [authUser.email]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const r = rows[0];
    return NextResponse.json({
      id: r.id, name: r.name, initials: r.initials, role: r.role,
      team: r.team, region: r.region, country: r.country,
      leadId: r.lead_id, email: r.email, avatarUrl: r.avatar_url,
      isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
    });
  } catch (err) {
    console.error('[me]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

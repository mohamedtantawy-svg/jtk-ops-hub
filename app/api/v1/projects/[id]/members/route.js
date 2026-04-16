import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

export async function GET(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { rows } = await query(
      `SELECT pm.id, pm.project_id, pm.member_id, pm.role, pm.created_at,
              m.name, m.email, m.initials, m.avatar_url
       FROM project_members pm
       JOIN members m ON m.id = pm.member_id
       WHERE pm.project_id = $1
       ORDER BY pm.created_at ASC`,
      [id]
    );
    return NextResponse.json(rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      memberId: r.member_id,
      role: r.role,
      name: r.name,
      email: r.email,
      initials: r.initials,
      avatarUrl: r.avatar_url,
      createdAt: r.created_at,
    })));
  } catch (err) {
    console.error('[members GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    if (!body.memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 });
    }
    const { rows } = await query(
      `INSERT INTO project_members (project_id, member_id, role)
       VALUES ($1, $2, $3) RETURNING *`,
      [id, body.memberId, body.role || 'contributor']
    );
    const r = rows[0];
    return NextResponse.json({
      id: r.id,
      projectId: r.project_id,
      memberId: r.member_id,
      role: r.role,
      createdAt: r.created_at,
    }, { status: 201 });
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'Member already in project' }, { status: 409 });
    }
    console.error('[members POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

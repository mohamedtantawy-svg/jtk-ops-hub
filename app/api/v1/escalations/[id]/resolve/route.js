import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Only managers/admins can resolve escalations
  if (!['admin', 'regional_manager', 'manager', 'team_lead'].includes(user.role)) {
    return NextResponse.json({ error: 'Only managers can resolve escalations' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const { rows } = await query(
      `UPDATE escalations
          SET status = 'resolved',
              resolved_at = NOW(),
              resolved_by = $2,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, user.email]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[escalations/resolve]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

export async function PATCH(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Only admins/managers can publish announcements
    if (!['admin', 'regional_manager', 'manager', 'team_lead'].includes(user.role)) {
      return NextResponse.json({ error: 'Only managers can publish announcements' }, { status: 403 });
    }

    const { id } = await params;
    const { rows } = await query(
      "UPDATE announcements SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcements/send]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

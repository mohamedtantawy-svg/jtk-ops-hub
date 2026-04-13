import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { requireRole } from '../../../../../../src/lib/auth-helpers';

export async function PATCH(req, { params }) {
  try {
    const { authorized, user, status, error } = requireRole(req, 'admin', 'manager');
    if (!authorized) return NextResponse.json({ error }, { status });

    const { id } = await params;
    const { rows } = await query(
      'UPDATE members SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[members/deactivate]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

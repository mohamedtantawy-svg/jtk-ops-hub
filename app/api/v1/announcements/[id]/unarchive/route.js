import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const { rows } = await query(
      "UPDATE announcements SET status = 'sent', updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcements/unarchive]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

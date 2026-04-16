import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Resolve user.id — JWT usually carries it, but fall back to DB lookup
    let userId = user.id ? Number(user.id) : null;
    if (!userId) {
      const r = await query('SELECT id FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1', [user.email]);
      userId = r.rows[0]?.id || null;
    }
    if (!userId) {
      return NextResponse.json({ error: 'Could not resolve user id' }, { status: 400 });
    }

    // Source of truth: announcement_acks table. Preserved forever.
    await query(
      `INSERT INTO announcement_acks (announcement_id, user_id, user_email)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [id, userId, user.email]
    );

    // Update timestamp
    await query('UPDATE announcements SET updated_at = NOW() WHERE id = $1', [id]);

    // Return canonical acks from announcement_acks table (source of truth)
    const acksResult = await query(
      'SELECT ARRAY_AGG(user_id) AS user_ids FROM announcement_acks WHERE announcement_id = $1',
      [id]
    );
    const acks = acksResult.rows[0]?.user_ids?.map(Number) || [];

    return NextResponse.json({ ok: true, acks });
  } catch (err) {
    console.error('[announcements/read]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

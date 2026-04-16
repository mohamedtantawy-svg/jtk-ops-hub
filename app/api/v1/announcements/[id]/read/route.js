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

    // Back-compat: keep read_by JSONB in sync with acks so any legacy code path
    // that still reads it sees the same data.
    const { rows } = await query(
      `UPDATE announcements
          SET read_by = CASE
            WHEN read_by IS NULL THEN jsonb_build_array(to_jsonb($2::int))
            WHEN NOT read_by @> to_jsonb($2::int)::jsonb THEN read_by || to_jsonb($2::int)::jsonb
            ELSE read_by
          END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, read_by`,
      [id, userId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, acks: rows[0].read_by || [] });
  } catch (err) {
    console.error('[announcements/read]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

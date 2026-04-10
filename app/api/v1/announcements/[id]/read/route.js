import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Ensure read_by column exists (safe to run repeatedly)
    await query(`
      ALTER TABLE announcements ADD COLUMN IF NOT EXISTS read_by JSONB DEFAULT '[]'::jsonb
    `);

    // Add userId to read_by array if not already present
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

    return NextResponse.json({ ok: true, read_by: rows[0].read_by });
  } catch (err) {
    console.error('[announcements/read]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

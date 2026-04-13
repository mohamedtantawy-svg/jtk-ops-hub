import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const { progress } = await req.json();

    if (typeof progress !== 'number' || progress < 0 || progress > 100) {
      return NextResponse.json({ error: 'Progress must be a number between 0 and 100' }, { status: 400 });
    }

    const { rows } = await query(
      'UPDATE projects SET progress = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [progress, id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true, progress: rows[0].progress });
  } catch (err) {
    console.error('[projects/progress]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

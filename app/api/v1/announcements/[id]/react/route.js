import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const { emoji } = await req.json();
    if (!emoji || typeof emoji !== 'string' || emoji.trim().length === 0 || emoji.length > 10) {
      return NextResponse.json({ error: 'Emoji must be a non-empty string (max 10 chars)' }, { status: 400 });
    }

    // Toggle reaction — insert or delete
    const existing = await query(
      'SELECT id FROM announcement_reactions WHERE announcement_id = $1 AND emoji = $2',
      [id, emoji]
    );

    if (existing.rows.length > 0) {
      await query('DELETE FROM announcement_reactions WHERE id = $1', [existing.rows[0].id]);
      return NextResponse.json({ action: 'removed' });
    }

    await query(
      'INSERT INTO announcement_reactions (announcement_id, emoji) VALUES ($1, $2)',
      [id, emoji]
    );
    return NextResponse.json({ action: 'added' }, { status: 201 });
  } catch (err) {
    console.error('[react]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

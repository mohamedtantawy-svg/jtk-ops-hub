import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

export async function POST(req, { params }) {
  try {
    const authUser = getAuthUser(req);
    const userId = authUser.id;
    const { id } = await params;
    const { emoji } = await req.json();
    if (!emoji || typeof emoji !== 'string' || emoji.trim().length === 0 || emoji.length > 10) {
      return NextResponse.json({ error: 'Emoji must be a non-empty string (max 10 chars)' }, { status: 400 });
    }

    // Toggle reaction — insert or delete (scoped to user)
    const existing = await query(
      'SELECT id FROM announcement_reactions WHERE announcement_id = $1 AND emoji = $2 AND user_id = $3',
      [id, emoji, userId]
    );

    if (existing.rows.length > 0) {
      await query('DELETE FROM announcement_reactions WHERE id = $1', [existing.rows[0].id]);
      return NextResponse.json({ action: 'removed' });
    }

    await query(
      'INSERT INTO announcement_reactions (announcement_id, emoji, user_id) VALUES ($1, $2, $3)',
      [id, emoji, userId]
    );
    return NextResponse.json({ action: 'added' }, { status: 201 });
  } catch (err) {
    console.error('[react]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

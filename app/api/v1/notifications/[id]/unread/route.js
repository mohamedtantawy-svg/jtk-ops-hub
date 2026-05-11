// ── POST /api/v1/notifications/[id]/unread ───────────────────────────────────
// Mark a single notification as unread. Idempotent — re-marking a row that's
// already unread is a no-op. Recipient guard ensures one user can't mutate
// another user's row. Mirror of [id]/read.

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
    const recipient = String(user.email).toLowerCase();

    const { rowCount } = await query(
      `UPDATE user_notifications
          SET read_at = NULL
        WHERE id = $1
          AND LOWER(recipient_email) = $2
          AND read_at IS NOT NULL`,
      [id, recipient]
    );
    return NextResponse.json({ ok: true, marked: rowCount });
  } catch (err) {
    console.error('[notifications/unread POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

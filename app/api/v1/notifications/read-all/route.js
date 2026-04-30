// ── POST /api/v1/notifications/read-all ─────────────────────────────────────
// Mark every unread notification for the caller as read. Returns the count
// of rows updated so the client can confirm the action visually.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';

export async function POST(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const recipient = String(user.email).toLowerCase();

    const { rowCount } = await query(
      `UPDATE user_notifications
          SET read_at = NOW()
        WHERE LOWER(recipient_email) = $1
          AND read_at IS NULL`,
      [recipient]
    );
    return NextResponse.json({ ok: true, marked: rowCount });
  } catch (err) {
    console.error('[notifications/read-all POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

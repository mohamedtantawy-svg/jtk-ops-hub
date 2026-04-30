// ── /api/v1/notifications — per-user notification feed ───────────────────────
// GET: returns the caller's most recent notifications + unread count. Server
// is the source of truth so unread state is consistent across tabs/devices
// and the bell stays accurate across reloads.
//
// Recipient is locked to the JWT email — there is no way for a caller to
// fetch someone else's notifications. This is enforced in SQL by filtering
// on LOWER(recipient_email) = LOWER($auth.email).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';

export async function GET(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const recipient = String(user.email).toLowerCase();

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));

    const [{ rows }, unreadResult] = await Promise.all([
      query(
        `SELECT id, recipient_email, type, title, body,
                link_view, link_id, source_type, source_id,
                actor_email, actor_name, created_at, read_at
           FROM user_notifications
          WHERE LOWER(recipient_email) = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [recipient, limit]
      ),
      query(
        `SELECT COUNT(*)::int AS n
           FROM user_notifications
          WHERE LOWER(recipient_email) = $1
            AND read_at IS NULL`,
        [recipient]
      ),
    ]);

    const items = rows.map(r => ({
      id: r.id,
      recipientEmail: r.recipient_email,
      type: r.type,
      title: r.title,
      body: r.body || '',
      linkView: r.link_view,
      linkId: r.link_id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      actorEmail: r.actor_email || null,
      actorName: r.actor_name || null,
      createdAt: r.created_at,
      readAt: r.read_at || null,
    }));

    return NextResponse.json({
      items,
      unreadCount: unreadResult.rows[0]?.n || 0,
    });
  } catch (err) {
    console.error('[notifications GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

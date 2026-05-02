// ── /api/v1/leader-alerts/comments/[id] ──────────────────────────────────
// PATCH  — edit a comment body (author or Alerts Admin only). Logs.
// DELETE — soft-delete (sets deleted_at). Logs.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { clean, writeLog, canAdministerLeaderAlerts } from '../../../../../../src/lib/leader-alerts-helpers';

async function loadComment(id) {
  const { rows } = await query(
    `SELECT id, alert_id, author_email, body, deleted_at FROM leader_alert_comment WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const existing = await loadComment(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.deleted_at) return NextResponse.json({ error: 'Comment was deleted' }, { status: 410 });

  const isAuthor = (existing.author_email || '').toLowerCase() === user.email.toLowerCase();
  const isAdmin = await canAdministerLeaderAlerts(user);
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: 'Only the author or an Alerts Admin can edit this comment' }, { status: 403 });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const body = clean(payload.body, 20_000);
  if (!body) return NextResponse.json({ error: 'body is required' }, { status: 400 });

  try {
    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE leader_alert_comment
            SET body = $1, edited_at = NOW()
          WHERE id = $2
          RETURNING *`,
        [body, id],
      );
      const row = rows[0];
      await writeLog(
        existing.alert_id,
        { email: user.email, name: user.name },
        'comment_edited',
        { commentId: id, prev: existing.body.slice(0, 200) },
        { commentId: id, next: body.slice(0, 200) },
        client,
      );
      return row;
    });
    return NextResponse.json({ comment: updated });
  } catch (err) {
    console.error('[leader-alerts.comment.patch]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  const user = getAuthUser(_req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const existing = await loadComment(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.deleted_at) return NextResponse.json({ ok: true, alreadyDeleted: true });

  const isAuthor = (existing.author_email || '').toLowerCase() === user.email.toLowerCase();
  const isAdmin = await canAdministerLeaderAlerts(user);
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: 'Only the author or an Alerts Admin can delete this comment' }, { status: 403 });
  }

  try {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE leader_alert_comment SET deleted_at = NOW() WHERE id = $1`,
        [id],
      );
      await writeLog(
        existing.alert_id,
        { email: user.email, name: user.name },
        'comment_deleted',
        { commentId: id, body: existing.body.slice(0, 200) },
        null,
        client,
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[leader-alerts.comment.delete]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

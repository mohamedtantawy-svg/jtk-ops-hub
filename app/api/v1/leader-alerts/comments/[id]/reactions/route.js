// ── /api/v1/leader-alerts/comments/[id]/reactions ───────────────────────
// POST   — add { emoji } reaction. Idempotent on (comment, user, emoji).
// DELETE — remove the current user's reaction with `?emoji=...`.
//
// Reactions are independent from the alert-level acknowledgement. UI shows
// a chip per emoji with a count + reactor list on hover.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../../src/lib/db';
import { writeLog } from '../../../../../../../src/lib/leader-alerts-helpers';

const MAX_EMOJI_LEN = 40;

async function loadCommentAlertId(id) {
  const { rows } = await query(
    `SELECT alert_id FROM leader_alert_comment WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows[0]?.alert_id || null;
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const alertId = await loadCommentAlertId(id);
  if (!alertId) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });

  let payload;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const emoji = typeof payload.emoji === 'string' ? payload.emoji.trim().slice(0, MAX_EMOJI_LEN) : '';
  if (!emoji) return NextResponse.json({ error: 'emoji is required' }, { status: 400 });

  try {
    const result = await query(
      `INSERT INTO leader_alert_comment_reaction (comment_id, email, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT (comment_id, email, emoji) DO NOTHING
       RETURNING created_at`,
      [id, user.email.toLowerCase(), emoji],
    );
    if (result.rowCount > 0) {
      // Best-effort log — don't fail the response if it errors.
      writeLog(
        alertId,
        { email: user.email, name: user.name },
        'reaction_added',
        null,
        { commentId: id, emoji },
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true, added: result.rowCount > 0 });
  } catch (err) {
    console.error('[leader-alerts.reaction.post]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const emoji = (searchParams.get('emoji') || '').slice(0, MAX_EMOJI_LEN);
  if (!emoji) return NextResponse.json({ error: 'emoji query param required' }, { status: 400 });

  const alertId = await loadCommentAlertId(id);
  if (!alertId) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });

  try {
    const result = await query(
      `DELETE FROM leader_alert_comment_reaction
        WHERE comment_id = $1 AND LOWER(email) = $2 AND emoji = $3`,
      [id, user.email.toLowerCase(), emoji],
    );
    if (result.rowCount > 0) {
      writeLog(
        alertId,
        { email: user.email, name: user.name },
        'reaction_removed',
        { commentId: id, emoji },
        null,
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true, removed: result.rowCount > 0 });
  } catch (err) {
    console.error('[leader-alerts.reaction.delete]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

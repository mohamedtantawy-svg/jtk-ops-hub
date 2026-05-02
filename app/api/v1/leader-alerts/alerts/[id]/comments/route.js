// ── /api/v1/leader-alerts/alerts/[id]/comments ───────────────────────────
// GET  — list comments for an alert. Supports `since=<ISO>` for the
//        5 s polling pattern (returns strictly-after rows).
// POST — add a comment. Parses @mentions, adds taggees as followers,
//        writes log + notifications per policy.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../../src/lib/roster-server';
import {
  clean,
  sanitiseAttachments,
  parseMentions,
  memberByEmail,
  listFollowerEmails,
  writeLog,
  writeNotifications,
  readAllSettings,
} from '../../../../../../../src/lib/leader-alerts-helpers';

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

  try {
    const sql = since
      ? `SELECT c.id, c.parent_comment_id, c.author_email, c.author_name, c.body,
                c.mention_emails, c.attachments, c.created_at, c.edited_at, c.deleted_at,
                COALESCE(
                  (SELECT json_agg(json_build_object('emoji', r.emoji, 'email', r.email) ORDER BY r.created_at)
                   FROM leader_alert_comment_reaction r WHERE r.comment_id = c.id),
                  '[]'::json
                ) AS reactions
         FROM leader_alert_comment c
         WHERE c.alert_id = $1 AND c.created_at > $2::timestamptz
         ORDER BY c.created_at ASC
         LIMIT $3`
      : `SELECT c.id, c.parent_comment_id, c.author_email, c.author_name, c.body,
                c.mention_emails, c.attachments, c.created_at, c.edited_at, c.deleted_at,
                COALESCE(
                  (SELECT json_agg(json_build_object('emoji', r.emoji, 'email', r.email) ORDER BY r.created_at)
                   FROM leader_alert_comment_reaction r WHERE r.comment_id = c.id),
                  '[]'::json
                ) AS reactions
         FROM leader_alert_comment c
         WHERE c.alert_id = $1
         ORDER BY c.created_at ASC
         LIMIT $2`;

    const { rows } = since
      ? await query(sql, [id, since, limit])
      : await query(sql, [id, limit]);

    return NextResponse.json({ comments: rows });
  } catch (err) {
    console.error('[leader-alerts.comments.list]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();
  const { id } = await params;

  let payload;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const body = clean(payload.body, 20_000);
  if (!body) return NextResponse.json({ error: 'body is required' }, { status: 400 });

  let attachments = [];
  try { attachments = sanitiseAttachments(payload.attachments); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 400 }); }

  const parentId = typeof payload.parent_comment_id === 'string' ? payload.parent_comment_id : null;

  try {
    // Confirm alert exists + grab the title for the notification body.
    const { rows: alertRows } = await query(`SELECT id, title FROM leader_alert WHERE id = $1`, [id]);
    if (alertRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const alertTitle = alertRows[0].title;

    const member = memberByEmail(user.email);
    const authorName = member?.name || user.name || user.email;
    const mentions = parseMentions(body);

    const created = await withTransaction(async (client) => {
      const insert = await client.query(
        `INSERT INTO leader_alert_comment
           (alert_id, parent_comment_id, author_email, author_name, body, mention_emails, attachments)
         VALUES ($1, $2, $3, $4, $5, $6::text[], $7::jsonb)
         RETURNING *`,
        [
          id, parentId,
          user.email.toLowerCase(),
          authorName,
          body,
          mentions,
          JSON.stringify(attachments),
        ],
      );
      const row = insert.rows[0];

      // Auto-follow the comment author + any tagged users.
      await client.query(
        `INSERT INTO leader_alert_follower (alert_id, email, source)
         VALUES ($1, $2, 'commenter')
         ON CONFLICT (alert_id, email) DO NOTHING`,
        [id, user.email.toLowerCase()],
      );
      for (const m of mentions) {
        if (m === user.email.toLowerCase()) continue;
        await client.query(
          `INSERT INTO leader_alert_follower (alert_id, email, source)
           VALUES ($1, $2, 'tagged')
           ON CONFLICT (alert_id, email) DO NOTHING`,
          [id, m],
        );
      }

      await writeLog(
        id,
        { email: user.email, name: authorName },
        'comment_added',
        null,
        { commentId: row.id, mentions },
        client,
      );

      return row;
    });

    // Notifications fan-out per policy. mention overrides mute.
    try {
      const settings = await readAllSettings();
      const policy = settings.notifications || {};

      // Mentions
      if (mentions.length && policy.mentionBell !== false) {
        await writeNotifications({
          recipients: mentions,
          excludeEmail: user.email,
          type: 'mention',
          title: `${authorName} mentioned you`,
          body: alertTitle,
          alertId: id,
          sourceType: 'leader_alert_mention',
          sourceId: created.id,
          actor: { email: user.email, name: authorName },
        });
      }

      // Comment notifications to followers (excl. muted, excl. mentioned —
      // they got a stronger notification already, excl. the author).
      if (policy.newCommentBell !== false) {
        const followers = await listFollowerEmails(id, { excludeMuted: true });
        const exclude = new Set([
          user.email.toLowerCase(),
          ...mentions,
        ]);
        await writeNotifications({
          recipients: followers.filter(f => !exclude.has(f)),
          excludeEmail: user.email,
          type: 'comment',
          title: `${authorName} commented`,
          body: alertTitle,
          alertId: id,
          sourceType: 'leader_alert_comment',
          sourceId: created.id,
          actor: { email: user.email, name: authorName },
        });
      }
    } catch (err) {
      console.warn('[leader-alerts.comments.create] notify failed:', err.message);
    }

    return NextResponse.json({ comment: created }, { status: 201 });
  } catch (err) {
    console.error('[leader-alerts.comments.create]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

// ── /api/v1/feedback/[id]/comments ───────────────────────────────────────
// GET   — list comments on a request, oldest-first.
// POST  — append a comment. Anyone authenticated can comment; the server
//          stamps author_id / author_email / author_name from the JWT so
//          the row is durable even if the user's display name changes.
//          Side-effects: notifies the submitter + everyone who has
//          previously commented (auto-follow), plus mentioned users.
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../src/lib/db';
import { MEMBERS_BY_EMAIL } from '../../../../../../src/data/members';
import { loadGroupsByHandle } from '../../../../../../src/lib/mention-groups';

// Parse @first.last mentions out of the comment body. Same loose rule HR
// Hub uses — surface lowercased emails for known members; unknown handles
// are dropped silently so a typo can't ghost-notify someone.
//
// `groupsByHandle` (optional) maps lowercased handles → member-email lists.
// When provided, a token whose value matches a handle expands to the
// group's full member set — same fan-out as if the user had typed each
// member individually. Group resolution wins over user resolution.
function parseMentions(text, groupsByHandle = null) {
  if (typeof text !== 'string' || !text) return [];
  const matches = text.match(/@([a-zA-Z0-9._-]+)/g) || [];
  const handles = matches.map(m => m.slice(1).toLowerCase());
  const found = new Set();
  for (const handle of handles) {
    if (groupsByHandle && groupsByHandle.has(handle)) {
      for (const e of groupsByHandle.get(handle) || []) {
        if (e) found.add(String(e).toLowerCase());
      }
      continue;
    }
    for (const email of Object.keys(MEMBERS_BY_EMAIL)) {
      const local = email.split('@')[0];
      if (local === handle || email === handle || email === `${handle}@deel.com`) {
        found.add(email);
        break;
      }
    }
  }
  return [...found];
}

// Fan-out notification writer scoped to the feedback board. Idempotent on
// (recipient, source_type, source_id) so the same comment never produces
// duplicate rows for the same person across retries.
async function writeFeedbackNotifications({
  recipients = [],
  excludeEmail,
  type,
  title,
  body = '',
  feedbackId,
  sourceType,
  sourceId,
  actor,
}) {
  const exclude = excludeEmail ? String(excludeEmail).toLowerCase() : null;
  const deduped = Array.from(new Set(
    recipients.map(e => String(e || '').toLowerCase()).filter(Boolean),
  )).filter(e => e !== exclude);
  if (deduped.length === 0) return 0;
  const values = [];
  const placeholders = [];
  let p = 1;
  for (const r of deduped) {
    placeholders.push(`($${p++}, $${p++}, $${p++}, $${p++}, 'feedback', $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    values.push(
      r,
      type,
      title,
      String(body).slice(0, 500),
      String(feedbackId),
      sourceType,
      String(sourceId || feedbackId),
      actor?.email || null,
      actor?.name || null,
    );
  }
  await query(
    `INSERT INTO user_notifications
       (recipient_email, type, title, body, link_view, link_id, source_type, source_id, actor_email, actor_name)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT DO NOTHING`,
    values,
  );
  return deduped.length;
}

function shape(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    authorId: row.author_id,
    authorEmail: row.author_email,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const { rows } = await query(
      'SELECT * FROM feedback_comments WHERE request_id = $1 ORDER BY created_at ASC',
      [id],
    );
    return NextResponse.json({ items: rows.map(shape) });
  } catch (err) {
    console.error('[feedback/comments/list]', err.message);
    return NextResponse.json({ error: 'Failed to load comments' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const rawText = typeof body.body === 'string' ? body.body.trim() : '';
  if (!rawText) return NextResponse.json({ error: 'body is required' }, { status: 400 });
  const text = rawText.slice(0, 8000);

  try {
    // Make sure the parent exists — saves a phantom comment + ON CASCADE will
    // drop orphans later if the parent disappears. We also fetch the
    // submitter + title up-front so the notification fan-out doesn't need a
    // second round-trip.
    const parent = await query(
      `SELECT submitter_email, submitter_name, title FROM feedback_requests WHERE id = $1`,
      [id],
    );
    if (parent.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const submitterEmail = (parent.rows[0].submitter_email || '').toLowerCase();
    const requestTitle = parent.rows[0].title || '(feedback request)';

    const groupsByHandle = await loadGroupsByHandle();
    const mentionEmails = parseMentions(text, groupsByHandle);

    const { rows } = await query(
      `INSERT INTO feedback_comments (request_id, author_id, author_email, author_name, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, user.id || null, user.email, user.name || null, text],
    );
    const commentId = rows[0].id;

    // Bump parent updated_at so the comment activity surfaces in
    // "recently_updated" sort.
    await query('UPDATE feedback_requests SET updated_at = NOW() WHERE id = $1', [id]);

    // Auto-follow via comment history: every previous commenter (plus the
    // submitter) is treated as a follower for notification fan-out. No
    // separate follower table — the comment stream is the source of truth.
    const followers = await query(
      `SELECT DISTINCT LOWER(author_email) AS email
         FROM feedback_comments
        WHERE request_id = $1 AND author_email IS NOT NULL`,
      [id],
    );
    const followerEmails = followers.rows.map(r => r.email).filter(Boolean);
    const recipients = [submitterEmail, ...followerEmails].filter(Boolean);

    const callerEmail = String(user.email || '').toLowerCase();
    const callerName = user.name || callerEmail;
    const titlePrefix = `${callerName} commented`;
    const snippetTitle = `${titlePrefix}: ${requestTitle}`.slice(0, 300);

    // Best-effort: a notification failure must never block the comment
    // landing. Wrap each fan-out so a transient DB hiccup just drops the
    // notification rather than 500-ing the comment POST.
    try {
      await writeFeedbackNotifications({
        recipients,
        excludeEmail: callerEmail,
        type: 'comment',
        title: snippetTitle,
        body: text,
        feedbackId: id,
        sourceType: 'feedback_comment',
        sourceId: commentId,
        actor: { email: callerEmail, name: callerName },
      });
      if (mentionEmails.length > 0) {
        await writeFeedbackNotifications({
          recipients: mentionEmails,
          excludeEmail: callerEmail,
          type: 'mention',
          title: `${callerName} mentioned you: ${requestTitle}`.slice(0, 300),
          body: text,
          feedbackId: id,
          sourceType: 'feedback_mention',
          sourceId: commentId,
          actor: { email: callerEmail, name: callerName },
        });
      }
    } catch (notifyErr) {
      console.warn('[feedback/comments/create] notification fan-out failed:', notifyErr.message);
    }

    return NextResponse.json({ item: shape(rows[0]) }, { status: 201 });
  } catch (err) {
    console.error('[feedback/comments/create]', err.message);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}

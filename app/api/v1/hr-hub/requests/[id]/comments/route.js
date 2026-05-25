// ── /api/v1/hr-hub/requests/[id]/comments ───────────────────────────────────
// GET  — paginated comment list (newest-batch model: cursor on created_at).
// POST — add a comment. Parses @mentions, adds them as followers, fans out
//        comment + mention notifications. Optimistic-friendly: returns the
//        full row + resolved mention emails so the FE doesn't need a re-GET.
//
// Body shape: { body: string, parentCommentId?: uuid, attachments?: [...] }
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../../src/lib/roster-server';
import {
  memberByEmail,
  parseMentions,
  addFollower,
  listFollowerEmails,
  writeLog,
  writeNotifications,
} from '../../../../../../../src/lib/hr-hub-helpers';
import { loadGroupsByHandle } from '../../../../../../../src/lib/mention-groups';
import { getCurrentDeptId } from '../../../../../../../src/lib/dept-scope';

const MAX_BODY_BYTES = 20000;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_PAYLOAD_BYTES = 30 * 1024 * 1024;
const ATTACHMENT_KINDS = new Set(['image', 'video', 'pdf']);
const ATTACHMENT_PREFIX_BY_KIND = {
  image: 'data:image/',
  video: 'data:video/',
  pdf: 'data:application/pdf',
};

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

function sanitiseAttachments(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('attachments must be an array');
  if (raw.length > MAX_ATTACHMENTS) {
    throw Object.assign(new Error(`Too many attachments (max ${MAX_ATTACHMENTS})`), { status: 413 });
  }
  let total = 0;
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const kind = ATTACHMENT_KINDS.has(a.kind) ? a.kind : null;
    const dataUri = typeof a.dataUri === 'string' ? a.dataUri : null;
    if (!kind || !dataUri) continue;
    const expected = ATTACHMENT_PREFIX_BY_KIND[kind];
    if (!expected || !dataUri.startsWith(expected)) continue;
    if (dataUri.length > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(new Error(`Attachment too large`), { status: 413 });
    }
    total += dataUri.length;
    if (total > MAX_TOTAL_PAYLOAD_BYTES) {
      throw Object.assign(new Error(`Total attachment payload too large`), { status: 413 });
    }
    out.push({ kind, dataUri, name: typeof a.name === 'string' ? a.name.slice(0, 200) : null });
  }
  return out;
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');                  // ISO timestamp, exclusive
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

  const sinceClause = since ? `AND created_at > $2::timestamptz` : '';
  const sql = `
    SELECT id, request_id, parent_comment_id, author_email, author_name,
           body, mention_emails, attachments, created_at, edited_at, deleted_at
      FROM hr_hub_comment
     WHERE request_id = $1 AND deleted_at IS NULL ${sinceClause}
     ORDER BY created_at ASC
     LIMIT ${limit}`;
  const args = since ? [id, since] : [id];
  const { rows } = await query(sql, args);
  return NextResponse.json({
    comments: rows.map(c => ({
      id: c.id,
      requestId: c.request_id,
      parentCommentId: c.parent_comment_id,
      authorEmail: c.author_email,
      authorName: c.author_name,
      body: c.body,
      mentionEmails: c.mention_emails || [],
      attachments: c.attachments || [],
      createdAt: c.created_at,
      editedAt: c.edited_at,
    })),
  });
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  await ensureRosterHydrated();

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'body is required' }, { status: 400 });
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: `body exceeds ${MAX_BODY_BYTES} chars` }, { status: 413 });
  }

  let attachments;
  try { attachments = sanitiseAttachments(body.attachments); }
  catch (err) {
    return NextResponse.json({ error: err.message || 'Invalid attachments' }, { status: err.status || 400 });
  }

  const parentId = body.parentCommentId && isUuid(body.parentCommentId) ? body.parentCommentId : null;

  // Confirm the request exists (cheap; lets us echo a clean 404 without a
  // post-insert FK error). `status` is read so we can auto-advance new →
  // in_progress when a manager comments (see end of this handler).
  const reqCheck = await query(
    `SELECT id, title, summary, status FROM hr_hub_request WHERE id = $1`, [id],
  );
  if (reqCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }
  const reqRow = reqCheck.rows[0];

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;
  // Load group handles once per POST so `@hrxtools` expands to every
  // member email and they all become followers + get notified, exactly
  // as if the author had typed each member individually. Phase 12b
  // (2026-05-25): scoped to caller's current dept so an HRX comment
  // can't ever fan out to a Payroll-only handle (or vice versa).
  const deptId = await getCurrentDeptId(user, req);
  const groupsByHandle = await loadGroupsByHandle({ deptId });
  const mentionEmails = parseMentions(text, groupsByHandle);

  const insert = await query(
    `INSERT INTO hr_hub_comment
       (request_id, parent_comment_id, author_email, author_name, body,
        mention_emails, attachments)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7::jsonb)
     RETURNING id, created_at`,
    [
      id, parentId, callerEmail, callerName, text,
      mentionEmails, JSON.stringify(attachments),
    ],
  );
  const commentId = insert.rows[0].id;

  // Author auto-follows the request. Mentioned users become followers
  // (rule 12). All idempotent.
  await addFollower(id, callerEmail, 'creator');
  for (const m of mentionEmails) await addFollower(id, m, 'tagged');

  await writeLog(
    id,
    { email: callerEmail, name: callerName },
    'comment_added',
    null,
    { commentId, snippet: text.slice(0, 200), mentions: mentionEmails },
  );

  // Notifications: every follower except the author gets a `comment`;
  // mentioned users additionally get a `mention` for higher visibility.
  const allFollowers = await listFollowerEmails(id);
  await writeNotifications({
    recipients: allFollowers,
    excludeEmail: callerEmail,
    type: 'comment',
    title: 'New comment',
    body: text.slice(0, 200),
    requestId: id,
    sourceType: 'hr_hub_comment',
    sourceId: commentId,
    actor: { email: callerEmail, name: callerName },
  });
  if (mentionEmails.length > 0) {
    await writeNotifications({
      recipients: mentionEmails,
      excludeEmail: callerEmail,
      type: 'mention',
      title: `${callerName} mentioned you`,
      body: text.slice(0, 200),
      requestId: id,
      sourceType: 'hr_hub_mention',
      sourceId: commentId,
      actor: { email: callerEmail, name: callerName },
    });
  }

  // Auto-advance new → in_progress when a manager (TL / RM / Admin)
  // comments. Mirrors the manual PATCH-status flow's audit-log shape so
  // the request history reads identically whether the move was manual
  // or comment-triggered. Idempotent via the `AND status = 'new'`
  // predicate — concurrent comments from two managers can't double-fire
  // the transition, and a request that's already moved on (in_progress,
  // on_hold, resolved) is left alone. We deliberately don't fan out a
  // separate `status_change` notification here: the comment
  // notification already alerted every follower that "something happened
  // on this request", and the status pill flip is visible inline. Adding
  // a second push for the same event would just be noise.
  const callerMember = memberByEmail(callerEmail);
  const isManager = !!callerMember && (
    callerMember.access === 'admin' ||
    callerMember.access === 'regional_manager' ||
    callerMember.access === 'team_lead'
  );
  let autoAdvancedStatus = null;
  if (isManager && reqRow.status === 'new') {
    try {
      const upd = await query(
        `UPDATE hr_hub_request
            SET status = 'in_progress', updated_at = NOW()
          WHERE id = $1 AND status = 'new'`,
        [id],
      );
      if (upd.rowCount > 0) {
        autoAdvancedStatus = 'in_progress';
        await writeLog(
          id,
          { email: callerEmail, name: callerName },
          'status_change',
          { status: 'new' },
          { status: 'in_progress', auto: true, trigger: 'manager_comment' },
        );
      }
    } catch (err) {
      // Audit-log failure must never reject the comment itself — the
      // primary write (the comment) has already succeeded and is the
      // user-visible action. Surface the auto-advance miss in server
      // logs so we can investigate without breaking the UX.
      console.warn('[hr-hub/comments] auto-advance failed:', err.message);
    }
  }

  return NextResponse.json({
    id: commentId,
    requestId: id,
    parentCommentId: parentId,
    authorEmail: callerEmail,
    authorName: callerName,
    body: text,
    mentionEmails,
    attachments,
    createdAt: insert.rows[0].created_at,
    autoAdvancedStatus,
  }, { status: 201 });
}

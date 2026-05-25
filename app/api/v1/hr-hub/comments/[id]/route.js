// ── /api/v1/hr-hub/comments/[id] ────────────────────────────────────────────
// PATCH  — edit a comment body (author or HR Hub Admin only).
// DELETE — soft-delete a comment (author or HR Hub Admin only).
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import {
  memberByEmail,
  isHrHubAdmin,
  parseMentions,
  addFollower,
  writeLog,
} from '../../../../../../src/lib/hr-hub-helpers';
import { loadGroupsByHandle } from '../../../../../../src/lib/mention-groups';
import { getCurrentDeptId } from '../../../../../../src/lib/dept-scope';

const MAX_BODY_BYTES = 20000;

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

async function loadComment(id) {
  const { rows } = await query(
    `SELECT * FROM hr_hub_comment WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] || null;
}

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  await ensureRosterHydrated();

  let patch;
  try { patch = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = typeof patch.body === 'string' ? patch.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'body is required' }, { status: 400 });
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: `body exceeds ${MAX_BODY_BYTES} chars` }, { status: 413 });
  }

  const existing = await loadComment(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;
  if (existing.author_email?.toLowerCase() !== callerEmail && !(await isHrHubAdmin(user))) {
    return NextResponse.json({ error: 'Forbidden — only the author or an HR Hub Admin can edit' }, { status: 403 });
  }

  // Phase 12b (2026-05-25): expand group handles on edit too, otherwise
  // adding @hrxtools via an edit silently failed to fan out to followers.
  // Scoped to the caller's current dept so cross-dept handles can't leak.
  const deptId = await getCurrentDeptId(user, req);
  const groupsByHandle = await loadGroupsByHandle({ deptId });
  const newMentions = parseMentions(text, groupsByHandle);
  const { rows } = await query(
    `UPDATE hr_hub_comment
        SET body = $1, mention_emails = $2::text[], edited_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [text, newMentions, id],
  );

  // Newly tagged users still become followers (rule 12). Already-tagged
  // users stay followers — addFollower is idempotent.
  for (const m of newMentions) await addFollower(existing.request_id, m, 'tagged');

  await writeLog(
    existing.request_id,
    { email: callerEmail, name: callerName },
    'comment_edited',
    { snippet: existing.body.slice(0, 200) },
    { commentId: id, snippet: text.slice(0, 200), mentions: newMentions },
  );

  const updated = rows[0];
  return NextResponse.json({
    id: updated.id,
    requestId: updated.request_id,
    body: updated.body,
    mentionEmails: updated.mention_emails || [],
    editedAt: updated.edited_at,
  });
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  await ensureRosterHydrated();

  const existing = await loadComment(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;
  if (existing.author_email?.toLowerCase() !== callerEmail && !(await isHrHubAdmin(user))) {
    return NextResponse.json({ error: 'Forbidden — only the author or an HR Hub Admin can delete' }, { status: 403 });
  }

  await query(`UPDATE hr_hub_comment SET deleted_at = NOW() WHERE id = $1`, [id]);
  await writeLog(
    existing.request_id,
    { email: callerEmail, name: callerName },
    'comment_deleted',
    { snippet: existing.body.slice(0, 200) },
    { commentId: id },
  );
  return NextResponse.json({ ok: true });
}

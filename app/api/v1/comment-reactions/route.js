// ── /api/v1/comment-reactions ───────────────────────────────────────────
// Polymorphic emoji-reaction endpoint shared by HR Hub, Feedback,
// Announcements, and Approval-Queue comment surfaces. Sarah Suge
// feedback 2026-05-14 — "Emoji Reactions to Messages".
//
// POST   { commentType, commentId, emoji }  → idempotent add
// DELETE { commentType, commentId, emoji }  → idempotent remove
//
// Permission: every authenticated user may react on every comment they
// can see. Visibility of the comment itself is enforced by the
// surface's own list endpoint; this route does not re-check it (a user
// would have to know the comment's id to forge a reaction, and the
// worst case is a misplaced emoji that any reader can also remove).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import {
  addReaction,
  removeReaction,
  isValidCommentType,
  isValidEmoji,
} from '../../../../src/lib/comment-reactions-helpers';
import { memberByEmail } from '../../../../src/lib/hide-task-helpers';

async function parseBody(req) {
  try { return await req.json(); }
  catch { return null; }
}

function validate(body) {
  if (!body || typeof body !== 'object') return 'Invalid JSON body';
  if (!isValidCommentType(body.commentType)) return 'commentType must be one of: hr_hub, feedback, announcement, announcement_request';
  if (!body.commentId) return 'commentId is required';
  if (!isValidEmoji(body.emoji)) return 'emoji is required (max 64 chars)';
  return null;
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await parseBody(req);
  const err = validate(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const email = String(user.email).toLowerCase();
  const name = user.name || memberByEmail(email)?.name || email;

  try {
    await addReaction({
      commentType: body.commentType,
      commentId: body.commentId,
      emoji: body.emoji,
      userEmail: email,
      userName: name,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error('[comment-reactions/POST]', e.message);
    return NextResponse.json({ error: e.message || 'Failed to add reaction' }, { status: 500 });
  }
}

export async function DELETE(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await parseBody(req);
  const err = validate(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    await removeReaction({
      commentType: body.commentType,
      commentId: body.commentId,
      emoji: body.emoji,
      userEmail: user.email,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error('[comment-reactions/DELETE]', e.message);
    return NextResponse.json({ error: e.message || 'Failed to remove reaction' }, { status: 500 });
  }
}

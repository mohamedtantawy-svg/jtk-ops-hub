// ── /api/v1/hr-hub/requests/[id]/followers/[email] ──────────────────────────
// DELETE — unfollow. Self-unfollow always allowed; HR Hub Admin can remove
//          any follower. Idempotent (404 if not present).
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../../../../src/lib/roster-server';
import {
  memberByEmail,
  isHrHubAdmin,
  removeFollower,
  writeLog,
} from '../../../../../../../../src/lib/hr-hub-helpers';

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const resolved = await params;
  const { id, email } = resolved;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  await ensureRosterHydrated();

  const targetEmail = decodeURIComponent(String(email)).toLowerCase();
  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;

  if (targetEmail !== callerEmail && !(await isHrHubAdmin(user))) {
    return NextResponse.json({ error: 'Forbidden — only HR Hub Admins can remove other followers' }, { status: 403 });
  }

  const removed = await removeFollower(id, targetEmail);
  if (removed) {
    await writeLog(
      id,
      { email: callerEmail, name: callerName },
      'follower_removed',
      { follower: targetEmail },
      null,
    );
  }
  return NextResponse.json({ ok: true, removed });
}

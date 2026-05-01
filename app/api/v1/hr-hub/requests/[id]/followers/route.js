// ── /api/v1/hr-hub/requests/[id]/followers ──────────────────────────────────
// POST — add a follower by email. Body: { email }. Idempotent.
//        Anyone authenticated can add themselves; HR Hub Admin can add anyone.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../../../src/lib/roster-server';
import {
  memberByEmail,
  isHrHubAdmin,
  addFollower,
  writeLog,
} from '../../../../../../../src/lib/hr-hub-helpers';

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
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

  const targetEmail = body.email ? String(body.email).toLowerCase() : null;
  if (!targetEmail) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;
  // Self-follow always allowed; following someone else needs HR Hub Admin.
  if (targetEmail !== callerEmail && !(await isHrHubAdmin(user))) {
    return NextResponse.json({ error: 'Forbidden — only HR Hub Admins can add other followers' }, { status: 403 });
  }

  const inserted = await addFollower(id, targetEmail, 'manual');
  if (inserted) {
    await writeLog(
      id,
      { email: callerEmail, name: callerName },
      'follower_added',
      null,
      { follower: targetEmail },
    );
  }
  return NextResponse.json({ ok: true, alreadyFollowing: !inserted });
}

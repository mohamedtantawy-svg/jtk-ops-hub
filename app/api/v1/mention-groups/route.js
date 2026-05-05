// ── /api/v1/mention-groups ─────────────────────────────────────────────────
// GET  — list every mention group with its members.
// POST — create a new group. Anyone authenticated can create (matches the
//        openness of HR Hub creation); creator is captured for the audit
//        list and to scope future "my groups" filtering if we add it.
//
// Body (POST): { handle, name?, description?, members: string[] }
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../src/lib/roster-server';
import { createGroup, listGroups } from '../../../../src/lib/mention-groups';
import { memberByEmail } from '../../../../src/lib/hr-hub-helpers';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const groups = await listGroups();
    return NextResponse.json({ groups });
  } catch (err) {
    console.error('[mention-groups GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;

  try {
    const group = await createGroup({
      handle: body.handle,
      name: body.name,
      description: body.description,
      members: body.members,
      creatorEmail: callerEmail,
      creatorName: callerName,
    });
    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[mention-groups POST]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to create' }, { status });
  }
}

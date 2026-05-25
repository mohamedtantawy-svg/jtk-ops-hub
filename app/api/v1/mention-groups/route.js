// ── /api/v1/mention-groups ─────────────────────────────────────────────────
// GET  — list every mention group the caller's CURRENT DEPT owns.
// POST — create a new group, stamped with the caller's current dept.
//        Anyone authenticated can create (matches the openness of HR Hub
//        creation); creator is captured for the audit list. Phase 12b
//        (2026-05-25): per-dept scoping — Josephine Tuoyo feedback that
//        the HRX hub group tag wasn't usable, plus the cross-dept rollout
//        needing each tenant to own their own pool.
//
// Body (POST): { handle, name?, description?, members: string[] }
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../src/lib/roster-server';
import { createGroup, listGroups } from '../../../../src/lib/mention-groups';
import { memberByEmail } from '../../../../src/lib/hr-hub-helpers';
import { getCurrentDeptId } from '../../../../src/lib/dept-scope';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const deptId = await getCurrentDeptId(user, req);
    const groups = await listGroups({ deptId });
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
  const deptId = await getCurrentDeptId(user, req);
  if (!deptId) {
    return NextResponse.json({ error: 'No active department for caller' }, { status: 400 });
  }

  try {
    const group = await createGroup({
      handle: body.handle,
      name: body.name,
      description: body.description,
      members: body.members,
      creatorEmail: callerEmail,
      creatorName: callerName,
      deptId,
    });
    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[mention-groups POST]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to create' }, { status });
  }
}

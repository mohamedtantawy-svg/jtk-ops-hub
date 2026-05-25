// ── /api/v1/mention-groups/[id] ────────────────────────────────────────────
// PATCH  — update name / description / members. Handle is immutable
//          (changing it would silently invalidate every comment that
//          already tagged the old handle).
// DELETE — soft-delete via FK CASCADE; any historical mention_emails
//          entries on existing comments stay intact (they're frozen
//          at-write).
//
// Phase 12b (2026-05-25): every operation is scoped to the caller's
// current dept. A tampered URL that points at another dept's group id
// gets a 404, not a leak.
//
// Body (PATCH): { name?, description?, members?: string[] }
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import { deleteGroup, getGroupById, updateGroup } from '../../../../../src/lib/mention-groups';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const deptId = await getCurrentDeptId(user, req);
  const group = await getGroupById(id, { deptId });
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ group });
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
  const deptId = await getCurrentDeptId(user, req);

  try {
    const group = await updateGroup(id, {
      name: patch.name,
      description: patch.description,
      members: patch.members,
    }, { deptId });
    return NextResponse.json({ group });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[mention-groups PATCH]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update' }, { status });
  }
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const deptId = await getCurrentDeptId(user, req);
  try {
    const ok = await deleteGroup(id, { deptId });
    return NextResponse.json({ ok });
  } catch (err) {
    console.error('[mention-groups DELETE]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to delete' }, { status: 500 });
  }
}

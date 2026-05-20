// ── DELETE /api/v1/urgent-assist-schedule/[id] ───────────────────────────
// Removes a single scheduled day from the rotation. Managers only.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import { isManagerOrAdmin } from '../../../../../src/lib/hide-task-helpers';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  await ensureRosterHydrated();
  const callerEmail = String(user.email).toLowerCase();
  if (!isManagerOrAdmin(callerEmail)) {
    return NextResponse.json({ error: 'Forbidden — only managers (TL/RM/admin) can delete schedule rows' }, { status: 403 });
  }

  // Phase 11f: refuse cross-dept deletes.
  const currentDeptId = await getCurrentDeptId(user, req);
  if (!currentDeptId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { rowCount } = await query(
    `DELETE FROM urgent_assist_schedule WHERE id = $1 AND org_node_id = $2`,
    [id, currentDeptId],
  );
  if (rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// ── POST /api/v1/hide-task/[id]/unhide ───────────────────────────────────
// Admin-only soft-undo for an entry in `hidden_task`. Flips `unhidden_at`
// from NULL to NOW(), which:
//   • drops the row from listActiveHidden (the partial unique index keys
//     off `unhidden_at IS NULL`, and the FE list query filters the same
//     way), so the next /hide-task/list poll returns it
//   • makes the (task_source, task_id) pair eligible for re-hide later
//     without violating the unique constraint
//   • preserves the original row for audit (we never DELETE)
// Busts the 30s server cache so the FE picks up the change immediately.
//
// Permission: admin only — keeps unhide as a privileged audit action,
// not something any TL/RM can do. If we want to widen later we can mirror
// the approve route's role check.
//
// Body: none — id is the hidden_task UUID, not the hr_hub_request id.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { memberByEmail } from '../../../../../../src/lib/hide-task-helpers';
import { cacheDel } from '../../../../../../src/lib/server-cache';

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  await ensureRosterHydrated();

  const callerEmail = String(user.email).toLowerCase();
  const me = memberByEmail(callerEmail);
  const access = (me?.access || '').toLowerCase();
  if (access !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  // Idempotent: if the row is already unhidden we still return ok=true so
  // double-clicks from the admin panel don't error. The WHERE clause makes
  // sure we don't reset `unhidden_at` to a fresher timestamp on a row
  // someone else already unhid.
  const { rows } = await query(
    `UPDATE hidden_task
        SET unhidden_at = NOW()
      WHERE id = $1 AND unhidden_at IS NULL
      RETURNING id, task_source, task_id, task_subject, unhidden_at`,
    [id],
  );

  // Bust the list cache so the next FE poll sees the row gone.
  cacheDel('hidden_task_list');

  if (rows.length === 0) {
    // Either the id doesn't exist or it was already unhidden — distinguish
    // for the caller by re-querying without the unhidden_at filter.
    const check = await query('SELECT id, unhidden_at FROM hidden_task WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, alreadyUnhidden: true, id });
  }

  return NextResponse.json({ ok: true, id, row: rows[0] });
}

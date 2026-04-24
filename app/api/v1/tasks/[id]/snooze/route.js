import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { canOperateOnTask, loadTaskForGuard, FORBIDDEN } from '../../../../../../src/lib/task-scope-guard';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';

// PATCH /api/v1/tasks/[id]/snooze
// `id` is either a UUID (internal tasks.id) or an external_id like "ZD-123".
// For external_ids referring to live Zendesk/Jira tickets (which may not yet
// have a row), we upsert a shadow row so snooze state survives page reload.
export async function PATCH(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    await ensureRosterHydrated();

    const { id } = await params;
    const { until } = await req.json();

    if (until) {
      const untilDate = new Date(until);
      if (isNaN(untilDate.getTime())) {
        return NextResponse.json({ error: 'Invalid date format for until' }, { status: 400 });
      }
      if (untilDate <= new Date()) {
        return NextResponse.json({ error: 'Snooze date must be in the future' }, { status: 400 });
      }
    }

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    // ── Scope check ──
    // For existing tasks we load the row and verify the caller can see it.
    // For fresh external_ids (cache-only tickets the DB hasn't seen yet) the
    // only trust anchor is the caller's ability to fetch /queue for them —
    // which is already scoped server-side, so an agent can't even learn an
    // out-of-scope id. Snooze is per-user-state so this is acceptable.
    const guardResult = await withTransaction(async (client) => {
      const task = await loadTaskForGuard(client, id);
      if (task && !canOperateOnTask(user, task)) return { forbidden: true };
      return { ok: true, task };
    });
    if (guardResult.forbidden) return NextResponse.json(FORBIDDEN, { status: 403 });

    let updatedRow = null;

    if (isUUID) {
      const { rows } = await query(
        `UPDATE tasks SET snoozed_until = $1, status = 'snoozed', updated_at = NOW() WHERE id = $2 RETURNING *`,
        [until || null, id],
      );
      updatedRow = rows[0] || null;
      if (!updatedRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    } else {
      // external_id path: upsert so live tickets get a persistent row
      const source = id.startsWith('ZD-') ? 'zendesk' : id.startsWith('PROJ-') || /^[A-Z]+-\d+$/.test(id) ? 'jira' : 'manual';
      const { rows } = await query(
        `INSERT INTO tasks (external_id, source, subject, status, snoozed_until)
         VALUES ($1, $2, $1, 'snoozed', $3)
         ON CONFLICT (external_id) DO UPDATE
           SET snoozed_until = EXCLUDED.snoozed_until,
               status = 'snoozed',
               updated_at = NOW()
         RETURNING *`,
        [id, source, until || null],
      );
      updatedRow = rows[0] || null;
    }

    if (!updatedRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Log activity (best-effort). Must not fail the snooze itself, but
    // at least surface failures in server logs instead of swallowing.
    try {
      await query(
        'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
        [updatedRow.id, 'snooze', until ? `Snoozed until ${until}` : 'Unsnoozed', user.name || 'System'],
      );
    } catch (e) {
      console.warn('[tasks/snooze] activity log failed:', e.message);
    }

    return NextResponse.json({ ok: true, snoozedUntil: updatedRow.snoozed_until });
  } catch (err) {
    console.error('[tasks/snooze]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

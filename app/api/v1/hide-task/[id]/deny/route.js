// ── POST /api/v1/hide-task/[id]/deny ─────────────────────────────────────
// Manager (or admin) denies a hide_task_request. Body: { reason: string }
// (required, ≤2000 chars). Side effects:
//   1. UPDATE hr_hub_request → status=resolved, resolution_note=reason.
//      No insert into hidden_task — the task stays visible in queues.
//   2. Write hr_hub_log (event_type='hide_denied', after.reason).
//   3. Notify the requester with the reason.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { writeLog, writeNotifications } from '../../../../../../src/lib/hr-hub-helpers';
import { memberByEmail } from '../../../../../../src/lib/hide-task-helpers';

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

  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  if (reason.length > 2000) return NextResponse.json({ error: 'reason too long (max 2000 chars)' }, { status: 400 });

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;

  const { rows } = await query(
    `SELECT id, flow, status, task_subject, created_by_email, team_lead_email
       FROM hr_hub_request WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const r = rows[0];
  if (r.flow !== 'hide_task_request') return NextResponse.json({ error: 'Not a hide task request' }, { status: 400 });
  if (r.status === 'resolved') return NextResponse.json({ error: 'Already resolved' }, { status: 409 });

  // Same permission gate as the approve route — any manager (TL/RM/admin)
  // may deny, self-decision hard-blocked for everyone (4-eyes).
  const me = memberByEmail(callerEmail);
  const access = (me?.access || '').toLowerCase();
  const isManager = access === 'admin' || access === 'regional_manager' || access === 'team_lead';
  if (!isManager) {
    return NextResponse.json({ error: 'Forbidden — only managers (TL/RM/admin) can deny hide requests' }, { status: 403 });
  }
  if ((r.created_by_email || '').toLowerCase() === callerEmail) {
    return NextResponse.json({ error: 'You cannot deny your own hide request — another manager must review it (4-eyes).' }, { status: 403 });
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE hr_hub_request
          SET status = 'resolved',
              resolution_note = $2,
              resolved_at = NOW(),
              updated_at = NOW(),
              assignee_email = COALESCE(assignee_email, $3),
              assignee_name  = COALESCE(assignee_name,  $4)
        WHERE id = $1`,
      [id, reason, callerEmail, callerName],
    );
    await writeLog(id, { email: callerEmail, name: callerName }, 'hide_denied',
      { status: r.status }, { status: 'resolved', reason }, client);
  });

  if (r.created_by_email) {
    try {
      await writeNotifications({
        recipients: [r.created_by_email],
        excludeEmail: callerEmail,
        type: 'status_change',
        title: 'Hide task request denied',
        body: `${r.task_subject ? `"${r.task_subject.slice(0, 100)}" — ` : ''}Reason: ${reason.slice(0, 200)}`,
        requestId: id,
        sourceType: 'hr_hub_status_change',
        sourceId: `${id}:denied:${Date.now()}`,
        actor: { email: callerEmail, name: callerName },
      });
    } catch (err) {
      console.warn('[hide-task/deny] notify requester failed:', err.message);
    }
  }

  return NextResponse.json({ ok: true, requestId: id, status: 'resolved' });
}

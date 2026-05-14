// ── POST /api/v1/sla-extension/[id]/deny ─────────────────────────────────
// Manager (or admin) denies an sla_extension_request. Body:
//   { reason: string }   ← required, ≤2000 chars
//
// Side effects:
//   1. UPDATE hr_hub_request — status='resolved', resolution_note=reason,
//      resolved_at=NOW(). No INSERT into sla_extension — the task keeps
//      its original SLA math.
//   2. writeLog (event_type='sla_extension_denied', after.reason).
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
    `SELECT id, flow, status, task_subject, created_by_email
       FROM hr_hub_request WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const r = rows[0];
  if (r.flow !== 'sla_extension_request') {
    return NextResponse.json({ error: 'Not an SLA extension request' }, { status: 400 });
  }
  if (r.status === 'resolved') {
    return NextResponse.json({ error: 'Already resolved' }, { status: 409 });
  }

  const me = memberByEmail(callerEmail);
  const access = (me?.access || '').toLowerCase();
  const isAdmin = access === 'admin';
  const isManager = isAdmin || access === 'regional_manager' || access === 'team_lead';
  if (!isManager) {
    return NextResponse.json({ error: 'Forbidden — only managers (TL/RM/admin) can deny SLA extensions' }, { status: 403 });
  }
  if ((r.created_by_email || '').toLowerCase() === callerEmail && !isAdmin) {
    return NextResponse.json({ error: 'You cannot deny your own SLA extension request — another manager must review it (4-eyes).' }, { status: 403 });
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
    await writeLog(id, { email: callerEmail, name: callerName }, 'sla_extension_denied',
      { status: r.status }, { status: 'resolved', reason }, client);
  });

  if (r.created_by_email) {
    try {
      await writeNotifications({
        recipients: [r.created_by_email],
        excludeEmail: callerEmail,
        type: 'status_change',
        title: 'SLA extension denied',
        body: `${r.task_subject ? `"${r.task_subject.slice(0, 100)}" — ` : ''}Reason: ${reason.slice(0, 200)}`,
        requestId: id,
        sourceType: 'hr_hub_status_change',
        sourceId: `${id}:denied:${Date.now()}`,
        actor: { email: callerEmail, name: callerName },
      });
    } catch (err) {
      console.warn('[sla-extension/deny] notify requester failed:', err.message);
    }
  }

  return NextResponse.json({ ok: true, requestId: id, status: 'resolved' });
}

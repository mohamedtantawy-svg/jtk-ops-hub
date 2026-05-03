// ── POST /api/v1/hide-task/[id]/approve ──────────────────────────────────
// Manager (or admin) approves a hide_task_request. Side effects:
//   1. UPDATE hr_hub_request → status=resolved, resolved_at=NOW().
//   2. INSERT INTO hidden_task — global hide list.
//   3. Bust the /api/v1/hide-task/list server cache so the next FE poll
//      picks up the change immediately.
//   4. Write hr_hub_log entry (event_type='approved').
//   5. Notify the original requester via user_notifications.
// Permission: only the requester's denormalised team_lead_email OR a
// system admin. Self-approval blocked.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { writeLog, writeNotifications } from '../../../../../../src/lib/hr-hub-helpers';
import { insertHiddenTask, memberByEmail } from '../../../../../../src/lib/hide-task-helpers';
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
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;

  // Load request + verify it's a hide_task_request still pending.
  const { rows } = await query(
    `SELECT id, flow, status, request_type, summary, links,
            task_source, task_id, task_url, task_subject,
            created_by_email, created_by_name, team_lead_email
       FROM hr_hub_request WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const r = rows[0];
  if (r.flow !== 'hide_task_request') {
    return NextResponse.json({ error: 'Not a hide task request' }, { status: 400 });
  }
  if (r.status === 'resolved') {
    return NextResponse.json({ error: 'Already resolved' }, { status: 409 });
  }
  if (!r.task_source || !r.task_id) {
    return NextResponse.json({ error: 'Request is missing task identity — cannot approve' }, { status: 422 });
  }

  // Permission gate (rebalanced 2026-05-04 audit + user directive):
  // any manager — TL / RM / admin — may approve a hide request. The
  // denormalised team_lead_email continues to drive the FE highlight,
  // but live testing showed routing breaks (admin requesters with empty
  // managerEmail, deleted-account TLs) leaving requests stuck pending
  // with no resolution path. Broadening to "any manager" matches the
  // FE's canDecide and keeps the workflow movable.
  // Self-approval remains hard-blocked for ALL roles, including admin —
  // true 4-eyes principle. Mirrors the FE gate.
  const me = memberByEmail(callerEmail);
  const access = (me?.access || '').toLowerCase();
  const isManager = access === 'admin' || access === 'regional_manager' || access === 'team_lead';
  if (!isManager) {
    return NextResponse.json({ error: 'Forbidden — only managers (TL/RM/admin) can approve hide requests' }, { status: 403 });
  }
  if ((r.created_by_email || '').toLowerCase() === callerEmail) {
    return NextResponse.json({ error: 'You cannot approve your own hide request — another manager must review it (4-eyes).' }, { status: 403 });
  }

  // Run the resolve + insert + log inside one transaction — if either side
  // fails the whole approval rolls back so the FE never sees a half-state.
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE hr_hub_request
          SET status = 'resolved',
              resolved_at = NOW(),
              updated_at = NOW(),
              assignee_email = COALESCE(assignee_email, $2),
              assignee_name  = COALESCE(assignee_name,  $3)
        WHERE id = $1`,
      [id, callerEmail, callerName],
    );
    await insertHiddenTask({
      taskSource: r.task_source,
      taskId: r.task_id,
      taskUrl: r.task_url || (Array.isArray(r.links) && r.links[0]) || null,
      taskSubject: r.task_subject || null,
      requestId: id,
      reasonCode: r.request_type || 'other',
      reasonText: r.summary || null,
      hiddenByEmail: r.created_by_email,
      hiddenByName: r.created_by_name,
      approvedByEmail: callerEmail,
      approvedByName: callerName,
    }, client);
    await writeLog(id, { email: callerEmail, name: callerName }, 'hide_approved',
      { status: r.status }, { status: 'resolved' }, client);
  });

  // Bust the list cache so /api/v1/hide-task/list returns the new entry on
  // the next FE poll instead of the stale-30s payload.
  cacheDel('hidden_task_list');

  // Notify the requester. Best-effort — failure here doesn't undo the
  // approval, but logs so we can spot delivery issues.
  if (r.created_by_email) {
    try {
      await writeNotifications({
        recipients: [r.created_by_email],
        excludeEmail: callerEmail,
        type: 'status_change',
        title: 'Hide task request approved',
        body: r.task_subject ? `"${r.task_subject.slice(0, 160)}" — hidden from queues.` : 'Your hide-task request was approved.',
        requestId: id,
        sourceType: 'hr_hub_status_change',
        sourceId: `${id}:approved:${Date.now()}`,
        actor: { email: callerEmail, name: callerName },
      });
    } catch (err) {
      console.warn('[hide-task/approve] notify requester failed:', err.message);
    }
  }

  return NextResponse.json({ ok: true, requestId: id, status: 'resolved' });
}

// ── POST /api/v1/sla-extension/[id]/approve ──────────────────────────────
// Manager (or admin) approves an sla_extension_request. Body:
//   { approvedDays: integer 1..7 }   ← required (manager picks)
//
// Side effects, all inside one transaction:
//   1. Mark any expired-but-unrevoked sla_extension row for the same
//      (task_source, task_id) as revoked so the partial unique index can
//      accept the new INSERT.
//   2. UPDATE hr_hub_request — status='resolved', resolved_at=NOW(),
//      sla_ext_approved_days=$approvedDays, assignee_email defaults to
//      caller if missing.
//   3. INSERT INTO sla_extension — effective_from=NOW(),
//      expires_at=NOW()+approved_days days. ON CONFLICT keeps the txn
//      alive (skill hide-task lesson: a caught 23505 still poisons the
//      enclosing txn).
//   4. writeLog (event_type='sla_extension_approved').
// After commit:
//   5. Notify the requester via user_notifications.
//
// Permission gate matches hide-task: any TL/RM/admin can approve; non-
// admins blocked from self-approval (4-eyes). Mirrors the FE canDecide
// rule rendered in HrHubView.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { writeLog, writeNotifications } from '../../../../../../src/lib/hr-hub-helpers';
import {
  insertSlaExtension,
  APPROVED_DAYS_MIN,
  APPROVED_DAYS_MAX,
} from '../../../../../../src/lib/sla-extension-helpers';
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
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const approvedDays = Number.parseInt(body?.approvedDays, 10);
  if (!Number.isInteger(approvedDays) || approvedDays < APPROVED_DAYS_MIN || approvedDays > APPROVED_DAYS_MAX) {
    return NextResponse.json(
      { error: `approvedDays must be an integer in [${APPROVED_DAYS_MIN}, ${APPROVED_DAYS_MAX}]` },
      { status: 400 },
    );
  }

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;

  const { rows } = await query(
    `SELECT id, flow, status, summary,
            task_source, task_id, task_url, task_subject,
            sla_ext_reason_code, sla_ext_requested_days,
            created_by_email, created_by_name
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
  if (!r.task_source || !r.task_id) {
    return NextResponse.json({ error: 'Request is missing task identity — cannot approve' }, { status: 422 });
  }
  if (!r.sla_ext_reason_code) {
    return NextResponse.json({ error: 'Request is missing a reason code — data corruption?' }, { status: 422 });
  }

  // Permission gate — mirrors hide-task. TL / RM / admin may decide;
  // non-admins blocked from self-approval (4-eyes).
  const me = memberByEmail(callerEmail);
  const access = (me?.access || '').toLowerCase();
  const isAdmin = access === 'admin';
  const isManager = isAdmin || access === 'regional_manager' || access === 'team_lead';
  if (!isManager) {
    return NextResponse.json({ error: 'Forbidden — only managers (TL/RM/admin) can approve SLA extensions' }, { status: 403 });
  }
  if ((r.created_by_email || '').toLowerCase() === callerEmail && !isAdmin) {
    return NextResponse.json({ error: 'You cannot approve your own SLA extension request — another manager must review it (4-eyes).' }, { status: 403 });
  }

  let extension = null;
  await withTransaction(async (client) => {
    // Cleanup any expired-but-unrevoked row for the same (source, id).
    // The partial unique index is `WHERE revoked_at IS NULL` only — it
    // doesn't drop expired rows automatically because NOW() can't appear
    // in an index predicate (Postgres requires IMMUTABLE). Revoking
    // expired rows here keeps the index honest.
    await client.query(
      `UPDATE sla_extension
          SET revoked_at = NOW()
        WHERE task_source = $1
          AND task_id     = $2
          AND revoked_at IS NULL
          AND expires_at <= NOW()`,
      [r.task_source, r.task_id],
    );

    await client.query(
      `UPDATE hr_hub_request
          SET status = 'resolved',
              resolved_at = NOW(),
              updated_at = NOW(),
              sla_ext_approved_days = $2,
              assignee_email = COALESCE(assignee_email, $3),
              assignee_name  = COALESCE(assignee_name,  $4)
        WHERE id = $1`,
      [id, approvedDays, callerEmail, callerName],
    );

    extension = await insertSlaExtension({
      taskSource: r.task_source,
      taskId: r.task_id,
      taskUrl: r.task_url || null,
      taskSubject: r.task_subject || null,
      requestId: id,
      reasonCode: r.sla_ext_reason_code,
      requestedByEmail: r.created_by_email,
      requestedByName: r.created_by_name,
      approvedByEmail: callerEmail,
      approvedByName: callerName,
      approvedDays,
    }, client);

    await writeLog(id, { email: callerEmail, name: callerName }, 'sla_extension_approved',
      { status: r.status, requestedDays: r.sla_ext_requested_days },
      { status: 'resolved', approvedDays }, client);
  });

  if (r.created_by_email) {
    try {
      await writeNotifications({
        recipients: [r.created_by_email],
        excludeEmail: callerEmail,
        type: 'status_change',
        title: 'SLA extension approved',
        body: r.task_subject
          ? `"${r.task_subject.slice(0, 140)}" — SLA extended by ${approvedDays} day${approvedDays === 1 ? '' : 's'}.`
          : `SLA extended by ${approvedDays} day${approvedDays === 1 ? '' : 's'}.`,
        requestId: id,
        sourceType: 'hr_hub_status_change',
        sourceId: `${id}:approved:${Date.now()}`,
        actor: { email: callerEmail, name: callerName },
      });
    } catch (err) {
      console.warn('[sla-extension/approve] notify requester failed:', err.message);
    }
  }

  return NextResponse.json({
    ok: true,
    requestId: id,
    status: 'resolved',
    approvedDays,
    extension,
  });
}

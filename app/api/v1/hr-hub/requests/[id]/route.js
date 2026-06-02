// ── /api/v1/hr-hub/requests/[id] ────────────────────────────────────────────
// GET   — full request detail: row + first 50 comments + followers + recent log.
// PATCH — edit status, assignee, priority, or any business field. Records
//         a log entry per changed field and fans out notifications to
//         followers (status_change / assignment).
//
// Permission model:
//   • Anyone authenticated can READ any request (rule 1).
//   • Anyone can PATCH their OWN request's fields.
//   • Assignee or HR Hub Admin can PATCH any request.
//   • Status moves are unrestricted for HR Hub Admin; non-admins can move
//     forward in the lifecycle only on their own requests.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { getEffectiveDeptIdsForUser } from '../../../../../../src/lib/dept-scope';
import {
  memberByEmail,
  isHrHubAdmin,
  writeLog,
  writeNotifications,
  listFollowerEmails,
  addFollower,
} from '../../../../../../src/lib/hr-hub-helpers';
import { resolveAssigneeWithOooCover } from '../../../../../../src/lib/hr-hub-ooo';

// `rejected` is a terminal state (alongside `resolved`) introduced
// 2026-05-12 — Megan reported HR requests/reporting sometimes get
// declined, not resolved. Both share rank 3 so moving between them
// (e.g. an admin reclassifies a closure) doesn't trip the
// backwards-direction guard below.
const ALLOWED_STATUSES = ['new', 'in_progress', 'on_hold', 'pending_requester', 'resolved', 'rejected'];
// `pending_requester` shares rank 2 with `on_hold` — both are "we're not
// actively working, we're waiting" states, just for different reasons
// (on_hold = paused by us, pending_requester = waiting on the requester).
// Moving between them is a sideways transition that the backwards-guard
// allows freely. Josephine Tuoyo 2026-05-25.
const STATUS_ORDER = {
  new: 0, in_progress: 1, on_hold: 2, pending_requester: 2, resolved: 3, rejected: 3,
};
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  await ensureRosterHydrated();

  // Phase 11c (2026-05-20): refuse cross-dept reads. 404 instead of leaking.
  // 2026-05-28: widened to effective dept ids so a TL covering another TL
  // across departments can open the requests in the covered queue.
  const effectiveDeptIds = await getEffectiveDeptIdsForUser(user, req);
  if (effectiveDeptIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [reqRes, commentsRes, followersRes, logRes] = await Promise.all([
    query(
      `SELECT id, flow, status, priority, function_area, request_type, report_type,
              title, summary, ideal_solution, resolution_note,
              links, attachments,
              created_by_email, created_by_name, assignee_email, assignee_name,
              cover_for_assignee_email, cover_for_assignee_name,
              team_lead_email, cc_email, created_at, updated_at, resolved_at,
              task_source, task_id, task_url, task_subject,
              sla_ext_requested_days, sla_ext_reason_code, sla_ext_acknowledged,
              sla_ext_approved_days,
              pr_contract_link, pr_client_name, pr_amount_usd, pr_amount_local, pr_local_currency,
              pr_cause, pr_cause_detail, pr_responsible_email, pr_responsible_name
         FROM hr_hub_request WHERE id = $1 AND org_node_id = ANY($2::uuid[])`,
      [id, effectiveDeptIds],
    ),
    query(
      `SELECT id, request_id, parent_comment_id, author_email, author_name,
              body, mention_emails, attachments, created_at, edited_at, deleted_at
         FROM hr_hub_comment
        WHERE request_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 50`,
      [id],
    ),
    query(
      `SELECT email, source, created_at FROM hr_hub_follower WHERE request_id = $1`,
      [id],
    ),
    query(
      `SELECT id, actor_email, actor_name, event_type, before_json, after_json, created_at
         FROM hr_hub_log
        WHERE request_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [id],
    ),
  ]);

  if (reqRes.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const r = reqRes.rows[0];

  // Splice emoji reactions onto each comment (Sarah Suge 2026-05-14
  // feedback "Emoji Reactions to Messages"). Single bulk query keyed on
  // the polymorphic (comment_type, comment_id) pair.
  const commentIds = commentsRes.rows.map(c => c.id);
  let reactionMap = new Map();
  if (commentIds.length > 0) {
    const { fetchReactionsForComments } = await import('../../../../../../src/lib/comment-reactions-helpers');
    reactionMap = await fetchReactionsForComments('hr_hub', commentIds);
  }

  return NextResponse.json({
    request: {
      id: r.id,
      flow: r.flow,
      status: r.status,
      priority: r.priority,
      functionArea: r.function_area,
      requestType: r.request_type,
      reportType: r.report_type,
      title: r.title,
      summary: r.summary,
      idealSolution: r.ideal_solution,
      resolutionNote: r.resolution_note,
      links: r.links || [],
      attachments: r.attachments || [],
      createdByEmail: r.created_by_email,
      createdByName: r.created_by_name,
      assigneeEmail: r.assignee_email,
      assigneeName: r.assignee_name,
      coverForAssigneeEmail: r.cover_for_assignee_email,
      coverForAssigneeName: r.cover_for_assignee_name,
      teamLeadEmail: r.team_lead_email,
      ccEmail: r.cc_email,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
      taskSource: r.task_source,
      taskId: r.task_id,
      taskUrl: r.task_url,
      taskSubject: r.task_subject,
      slaExtRequestedDays: r.sla_ext_requested_days,
      slaExtReasonCode: r.sla_ext_reason_code,
      slaExtAcknowledged: r.sla_ext_acknowledged,
      slaExtApprovedDays: r.sla_ext_approved_days,
      // Payment Refund flow — intake + assessment. Null on every other flow.
      prContractLink: r.pr_contract_link,
      prClientName: r.pr_client_name,
      prAmountUsd: r.pr_amount_usd,
      prAmountLocal: r.pr_amount_local,
      prLocalCurrency: r.pr_local_currency,
      prCause: r.pr_cause,
      prCauseDetail: r.pr_cause_detail,
      prResponsibleEmail: r.pr_responsible_email,
      prResponsibleName: r.pr_responsible_name,
    },
    comments: commentsRes.rows.map(c => ({
      id: c.id,
      requestId: c.request_id,
      parentCommentId: c.parent_comment_id,
      authorEmail: c.author_email,
      authorName: c.author_name,
      body: c.body,
      mentionEmails: c.mention_emails || [],
      attachments: c.attachments || [],
      createdAt: c.created_at,
      editedAt: c.edited_at,
      reactions: reactionMap.get(String(c.id)) || [],
    })),
    followers: followersRes.rows,
    log: logRes.rows.map(l => ({
      id: l.id,
      actorEmail: l.actor_email,
      actorName: l.actor_name,
      eventType: l.event_type,
      before: l.before_json,
      after: l.after_json,
      createdAt: l.created_at,
    })),
  });
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

  // Phase 11c (2026-05-20): refuse cross-dept edits. SELECT scoped to dept
  // so a request in another tenant looks the same as a non-existent one.
  // 2026-05-28: widened to effective dept ids so an active coverer can
  // edit the covered TL's requests across departments.
  const effectiveDeptIds = await getEffectiveDeptIdsForUser(user, req);
  if (effectiveDeptIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { rows: existingRows } = await query(
    `SELECT * FROM hr_hub_request WHERE id = $1 AND org_node_id = ANY($2::uuid[])`,
    [id, effectiveDeptIds],
  );
  if (existingRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const existing = existingRows[0];

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;
  const isOwner = existing.created_by_email?.toLowerCase() === callerEmail;
  const isAssignee = existing.assignee_email?.toLowerCase() === callerEmail;
  const admin = await isHrHubAdmin(user);
  // 2026-05-04 user directive: "any manager can change the status — doesn't
  // have to be the assignee". Open the gate to TL / RM / Admin in addition
  // to the request's own creator / assignee. Non-managerial roster members
  // who aren't the creator / assignee still get the 403.
  const callerMember = memberByEmail(callerEmail);
  const callerAccess = (callerMember?.access || '').toLowerCase();
  const isManagerCaller = callerAccess === 'admin'
    || callerAccess === 'regional_manager'
    || callerAccess === 'team_lead';
  const isPrivilegedCaller = isOwner || isAssignee || admin || isManagerCaller;

  // 2026-05-28 (Mohamed spec): status changes on HR Request / HR Reporting
  // (and the other non-approval flows) should be doable by ANYONE with
  // read access — covering teammates, peer agents, anyone helping move a
  // ticket along. Only the approval flows (SLA extension + Hide request)
  // keep the manager-only gate because their workflow IS the manager
  // review. Priority, assignee, and free-text edits stay gated to the
  // existing privileged cohort on every flow.
  const APPROVAL_FLOWS = new Set(['sla_extension_request', 'hide_task_request']);
  const isApprovalFlow = APPROVAL_FLOWS.has(existing.flow);
  // The non-status patch surface — anything in this set still requires
  // owner/assignee/manager/admin. Keep aligned with the patch fields
  // handled below so a new field added there doesn't accidentally leak
  // through the status-only carve-out.
  const NON_STATUS_PATCH_FIELDS = [
    'priority', 'assigneeEmail',
    'title', 'summary', 'idealSolution', 'resolutionNote',
    'functionArea', 'requestType', 'reportType',
    // Payment Refund assessment — captured at the New -> In Progress
    // transition. Listed here so it stays gated to owner/assignee/
    // manager/admin and never leaks through the status-only carve-out
    // that lets any reader move a non-approval flow's status.
    'cause', 'causeDetail', 'responsibleEmail',
  ];
  const touchesNonStatus = NON_STATUS_PATCH_FIELDS.some(f => patch[f] !== undefined);

  // Payment Refund cause taxonomy — mirrors the DB CHECK
  // (hr_hub_request_pr_cause_check). 'other' requires a free-text detail.
  const ALLOWED_PR_CAUSES = new Set(['manual_error', 'system_error', 'other']);

  if (!isPrivilegedCaller) {
    if (isApprovalFlow) {
      return NextResponse.json({ error: 'Forbidden — approval flows can only be edited by the creator, assignee, manager, or HR Hub Admin' }, { status: 403 });
    }
    if (touchesNonStatus) {
      return NextResponse.json({ error: 'Forbidden — only the creator, assignee, manager, or HR Hub Admin can edit fields other than status' }, { status: 403 });
    }
    // Else: status-only patch on a non-approval flow → allow.
  }

  // Payment Refund assessment gate. Moving the row out of 'new' into
  // 'in_progress' is the "assessed" moment — the cause + the responsible
  // team member MUST be recorded then, so the data is never lost to a
  // bare status flip. Enforced server-side (FE-only gating isn't
  // enforcement) and at BOTH transition paths: the comment-driven
  // auto-advance is suppressed for this flow (see the comments route), so
  // the only way to in_progress is this PATCH carrying the assessment.
  const isPrAssessmentTransition = existing.flow === 'payment_refund'
    && existing.status === 'new'
    && patch.status === 'in_progress';
  if (isPrAssessmentTransition) {
    const cause = typeof patch.cause === 'string' ? patch.cause : null;
    if (!ALLOWED_PR_CAUSES.has(cause)) {
      return NextResponse.json({ error: `cause is required to move a Payment Refund to In Progress — one of: ${[...ALLOWED_PR_CAUSES].join(', ')}` }, { status: 400 });
    }
    if (cause === 'other' && !(typeof patch.causeDetail === 'string' && patch.causeDetail.trim())) {
      return NextResponse.json({ error: 'causeDetail is required when cause is "other" — specify what caused the refund' }, { status: 400 });
    }
    if (!(typeof patch.responsibleEmail === 'string' && patch.responsibleEmail.trim())) {
      return NextResponse.json({ error: 'responsibleEmail is required — indicate the team member responsible for the loss' }, { status: 400 });
    }
  }

  const updates = [];
  const values = [];
  const logs = [];
  let p = 1;
  const after = {};

  if (patch.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(patch.status)) {
      return NextResponse.json({ error: `Invalid status: ${patch.status}` }, { status: 400 });
    }
    if (patch.status !== existing.status) {
      // Status direction guard: only HR Hub Admin / assignee / any manager
      // (TL/RM/Admin) can move a status backwards on APPROVAL flows
      // (SLA extension + Hide request) because their workflow has a
      // formal review step. Non-approval flows (hr_request, hr_reporting,
      // escalation_zero, feedback) accept either direction per Mohamed
      // 2026-05-28: "the rest of the task types can have a status
      // changed by anyone if needed" — including reverting a wrongly-
      // resolved ticket without manager intervention.
      if (isApprovalFlow && !admin && !isAssignee && !isManagerCaller) {
        if (STATUS_ORDER[patch.status] < STATUS_ORDER[existing.status]) {
          return NextResponse.json({ error: 'Only HR Hub Admin, assignee, or a manager can move an approval flow backwards' }, { status: 403 });
        }
      }
      updates.push(`status = $${p++}`); values.push(patch.status);
      // `resolved_at` doubles as the "closed-at" timestamp for either
      // terminal status — Megan's 2026-05-12 ask added `rejected` as a
      // close path, so we stamp on both transitions in and clear on
      // re-open (move back to a non-terminal state).
      const TERMINAL = new Set(['resolved', 'rejected']);
      const wasTerminal = TERMINAL.has(existing.status);
      const isTerminal = TERMINAL.has(patch.status);
      if (!wasTerminal && isTerminal) {
        updates.push(`resolved_at = NOW()`);
      } else if (wasTerminal && !isTerminal) {
        updates.push(`resolved_at = NULL`);
      }
      logs.push({ event: 'status_change', before: { status: existing.status }, after: { status: patch.status } });
      after.status = patch.status;
    }
  }

  if (patch.priority !== undefined) {
    if (!ALLOWED_PRIORITIES.has(patch.priority)) {
      return NextResponse.json({ error: `Invalid priority: ${patch.priority}` }, { status: 400 });
    }
    if (patch.priority !== existing.priority) {
      updates.push(`priority = $${p++}`); values.push(patch.priority);
      logs.push({ event: 'priority_change', before: { priority: existing.priority }, after: { priority: patch.priority } });
      after.priority = patch.priority;
    }
  }

  if (patch.assigneeEmail !== undefined) {
    const rawNewEmail = patch.assigneeEmail ? String(patch.assigneeEmail).toLowerCase() : null;
    if (rawNewEmail !== (existing.assignee_email || null)) {
      const rawNewName = rawNewEmail ? (memberByEmail(rawNewEmail)?.name || null) : null;
      // 2026-05-22 — Jose Ruales spec: a manual reassign to an OOO
      // user is re-routed to their first non-OOO manager. The original
      // is stamped in cover_for_assignee_email so the reconciler can
      // flip the row back the moment they're back. Manual reassign to
      // a non-OOO user clears any prior cover (the requester explicitly
      // chose this owner). Null assignee (unassign) also clears the
      // cover — there's no original to restore.
      let effectiveEmail = rawNewEmail;
      let effectiveName = rawNewName;
      let nextCoverEmail = null;
      let nextCoverName = null;
      let redirected = false;
      if (rawNewEmail) {
        const resolved = await resolveAssigneeWithOooCover(rawNewEmail, rawNewName);
        effectiveEmail = resolved.assigneeEmail;
        effectiveName = resolved.assigneeName;
        nextCoverEmail = resolved.coverForEmail;
        nextCoverName = resolved.coverForName;
        redirected = resolved.redirected;
      }
      updates.push(`assignee_email = $${p++}`); values.push(effectiveEmail);
      updates.push(`assignee_name  = $${p++}`); values.push(effectiveName);
      // Cover stamp always overwrites — null when the new assignee is
      // not OOO, populated when the redirect kicked in.
      updates.push(`cover_for_assignee_email = $${p++}`); values.push(nextCoverEmail);
      updates.push(`cover_for_assignee_name  = $${p++}`); values.push(nextCoverName);
      // Mark as manually-assigned so the next Team Lead On Call
      // rotation skips this row (Mohamed 2026-05-14 spec: "the
      // assignment should change as well with exception to anything
      // that has been assigned manually"). Idempotent — re-flipping a
      // row already TRUE is a no-op.
      updates.push(`assignee_manually_set = $${p++}`); values.push(true);
      logs.push({
        event: 'assignee_change',
        before: { assigneeEmail: existing.assignee_email },
        after: { assigneeEmail: effectiveEmail, manuallySet: true },
      });
      if (redirected) {
        logs.push({
          event: 'auto_cover_assigned',
          before: { assigneeEmail: nextCoverEmail },
          after: { assigneeEmail: effectiveEmail, coverForEmail: nextCoverEmail, reason: 'assignee_currently_ooo' },
        });
      }
      after.assigneeEmail = effectiveEmail;
      // Auto-follow: any new assignee starts following. The covered
      // original also gets added so they pick up the trail on return.
      if (effectiveEmail) await addFollower(id, effectiveEmail, 'assignee');
      if (nextCoverEmail) await addFollower(id, nextCoverEmail, 'assignee');
    }
  }

  // Free-text fields editable by owner/assignee/admin.
  for (const [field, col, max] of [
    ['title',           'title',           300],
    ['summary',         'summary',         20000],
    ['idealSolution',   'ideal_solution',  20000],
    ['resolutionNote',  'resolution_note', 20000],
    ['functionArea',    'function_area',   80],
    ['requestType',     'request_type',    80],
    ['reportType',      'report_type',     80],
  ]) {
    if (patch[field] !== undefined) {
      const next = patch[field] == null ? null : String(patch[field]).slice(0, max);
      const prev = existing[col];
      if ((next || null) !== (prev || null)) {
        updates.push(`${col} = $${p++}`);
        values.push(next);
        logs.push({ event: 'field_edit', before: { [field]: prev }, after: { [field]: next } });
        after[field] = next;
      }
    }
  }

  // Payment Refund assessment — persist cause / cause detail / responsible
  // member. Resolves the responsible member's display name from the roster
  // (same pattern as the assignee handler). Each change writes a
  // field_edit log row so the assessment is auditable in hr_hub_log.
  if (patch.cause !== undefined) {
    const nextCause = patch.cause == null ? null : String(patch.cause);
    if (nextCause !== null && !ALLOWED_PR_CAUSES.has(nextCause)) {
      return NextResponse.json({ error: `Invalid cause: ${nextCause}` }, { status: 400 });
    }
    if ((nextCause || null) !== (existing.pr_cause || null)) {
      updates.push(`pr_cause = $${p++}`); values.push(nextCause);
      logs.push({ event: 'field_edit', before: { cause: existing.pr_cause }, after: { cause: nextCause } });
      after.cause = nextCause;
    }
  }
  if (patch.causeDetail !== undefined) {
    // Only meaningful when cause is 'other'; clear it otherwise so a
    // later re-classification to manual/system doesn't leave a stale note.
    const causeNow = patch.cause !== undefined ? patch.cause : existing.pr_cause;
    const nextDetail = causeNow === 'other'
      ? (patch.causeDetail == null ? null : String(patch.causeDetail).slice(0, 20000))
      : null;
    if ((nextDetail || null) !== (existing.pr_cause_detail || null)) {
      updates.push(`pr_cause_detail = $${p++}`); values.push(nextDetail);
      after.causeDetail = nextDetail;
    }
  }
  if (patch.responsibleEmail !== undefined) {
    const respEmail = patch.responsibleEmail ? String(patch.responsibleEmail).toLowerCase() : null;
    const respName = respEmail ? (memberByEmail(respEmail)?.name || patch.responsibleName || null) : null;
    if ((respEmail || null) !== (existing.pr_responsible_email || null)) {
      updates.push(`pr_responsible_email = $${p++}`); values.push(respEmail);
      updates.push(`pr_responsible_name  = $${p++}`); values.push(respName);
      logs.push({ event: 'field_edit', before: { responsibleEmail: existing.pr_responsible_email }, after: { responsibleEmail: respEmail } });
      after.responsibleEmail = respEmail;
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  updates.push(`updated_at = NOW()`);
  // Phase 11c: UPDATE also dept-scoped so a concurrent dept-move between
  // the SELECT above and the UPDATE here can't widen the blast radius.
  // 2026-05-28: same effective-dept widening as the SELECT — coverers can
  // PATCH rows in the covered TL's dept during active OOO.
  const sql = `UPDATE hr_hub_request SET ${updates.join(', ')} WHERE id = $${p} AND org_node_id = ANY($${p + 1}::uuid[]) RETURNING *`;
  values.push(id, effectiveDeptIds);
  const { rows } = await query(sql, values);
  const updated = rows[0];

  // Audit + notifications. Run inside a transaction so a failure here
  // doesn't leave the row updated without a log entry.
  await withTransaction(async (client) => {
    for (const l of logs) {
      await writeLog(id, { email: callerEmail, name: callerName }, l.event, l.before, l.after, client);
    }
  });

  // Fan-out notifications. Followers always get them; we exclude the actor.
  const followers = await listFollowerEmails(id);
  for (const l of logs) {
    if (l.event === 'status_change') {
      await writeNotifications({
        recipients: followers,
        excludeEmail: callerEmail,
        type: 'status_change',
        title: `Status: ${l.after.status}`,
        body: (updated.title || updated.summary || '').slice(0, 200),
        requestId: id,
        sourceType: 'hr_hub_status_change',
        sourceId: `${id}:${Date.now()}`,
        actor: { email: callerEmail, name: callerName },
      });
    } else if (l.event === 'assignee_change' && l.after.assigneeEmail) {
      // Notify the new assignee specifically + followers.
      await writeNotifications({
        recipients: Array.from(new Set([l.after.assigneeEmail, ...followers])),
        excludeEmail: callerEmail,
        type: 'assignment',
        title: `Assigned to you`,
        body: (updated.title || updated.summary || '').slice(0, 200),
        requestId: id,
        sourceType: 'hr_hub_assignment',
        sourceId: `${id}:${Date.now()}`,
        actor: { email: callerEmail, name: callerName },
      });
    }
  }

  return NextResponse.json({ ok: true, changed: true, after });
}

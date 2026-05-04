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
import {
  memberByEmail,
  isHrHubAdmin,
  writeLog,
  writeNotifications,
  listFollowerEmails,
  addFollower,
} from '../../../../../../src/lib/hr-hub-helpers';

const ALLOWED_STATUSES = ['new', 'in_progress', 'on_hold', 'resolved'];
const STATUS_ORDER = Object.fromEntries(ALLOWED_STATUSES.map((s, i) => [s, i]));
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

  const [reqRes, commentsRes, followersRes, logRes] = await Promise.all([
    query(
      `SELECT id, flow, status, priority, function_area, request_type, report_type,
              title, summary, ideal_solution, resolution_note,
              links, attachments,
              created_by_email, created_by_name, assignee_email, assignee_name,
              team_lead_email, cc_email, created_at, updated_at, resolved_at,
              task_source, task_id, task_url, task_subject
         FROM hr_hub_request WHERE id = $1`,
      [id],
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
      teamLeadEmail: r.team_lead_email,
      ccEmail: r.cc_email,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
      taskSource: r.task_source,
      taskId: r.task_id,
      taskUrl: r.task_url,
      taskSubject: r.task_subject,
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

  const { rows: existingRows } = await query(
    `SELECT * FROM hr_hub_request WHERE id = $1`,
    [id],
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
  if (!isOwner && !isAssignee && !admin && !isManagerCaller) {
    return NextResponse.json({ error: 'Forbidden — not creator, assignee, manager, or HR Hub Admin' }, { status: 403 });
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
      // (TL/RM/Admin) can move a status backwards. Owners (creators who
      // aren't also managers) can still move forward but not back —
      // matches the original intent.
      if (!admin && !isAssignee && !isManagerCaller) {
        if (STATUS_ORDER[patch.status] < STATUS_ORDER[existing.status]) {
          return NextResponse.json({ error: 'Only HR Hub Admin, assignee, or a manager can move a status backwards' }, { status: 403 });
        }
      }
      updates.push(`status = $${p++}`); values.push(patch.status);
      if (patch.status === 'resolved') {
        updates.push(`resolved_at = NOW()`);
      } else if (existing.status === 'resolved') {
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
    const newEmail = patch.assigneeEmail ? String(patch.assigneeEmail).toLowerCase() : null;
    if (newEmail !== (existing.assignee_email || null)) {
      const newName = newEmail ? (memberByEmail(newEmail)?.name || null) : null;
      updates.push(`assignee_email = $${p++}`); values.push(newEmail);
      updates.push(`assignee_name  = $${p++}`); values.push(newName);
      logs.push({
        event: 'assignee_change',
        before: { assigneeEmail: existing.assignee_email },
        after: { assigneeEmail: newEmail },
      });
      after.assigneeEmail = newEmail;
      // Auto-follow: any new assignee starts following.
      if (newEmail) await addFollower(id, newEmail, 'assignee');
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

  if (updates.length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  updates.push(`updated_at = NOW()`);
  const sql = `UPDATE hr_hub_request SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`;
  values.push(id);
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

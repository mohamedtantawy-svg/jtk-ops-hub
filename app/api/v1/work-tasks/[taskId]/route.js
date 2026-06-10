// ── /api/v1/work-tasks/[taskId] (Phase 1, 2026-05-25) ──────────────────────
// GET    — fetch one task with its comments + activity for the detail
//          drawer. Permission: caller must be in the task's dept.
// PATCH  — partial update. Edits gated to creator / assignee / follower /
//          dept admin (canEditWorkTask). Re-fans-out notifications when:
//            • status changes               → task_status_change to stakeholders
//            • new assignees appear         → task_assigned to delta
//            • assignees removed            → task_unassigned to delta
// DELETE — soft-delete (sets is_archived=true). Same permission as PATCH.
//          Notifies stakeholders that the task was archived.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';
import { canManageOrgNode } from '../../../../../src/lib/org-admin';
import {
  rowToTask,
  rowToComment,
  validateRosterEmails,
  normaliseTags,
  fetchOooEmails,
  fanOutTaskNotifications,
  recordTaskActivity,
  taskStakeholders,
  canEditWorkTask,
  VALID_STATUSES,
  VALID_PRIORITIES,
  TASK_NAME_MAX,
  TASK_DESCRIPTION_MAX,
  MAX_ASSIGNEES,
  MAX_FOLLOWERS,
} from '../../../../../src/lib/work-tasks-helpers';

function parseDueDate(raw) {
  if (raw == null) return { value: null, set: true };
  if (raw === '' || raw === false) return { value: null, set: true };
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    const err = new Error('dueDate must be an ISO string, epoch ms, or null');
    err.status = 400;
    throw err;
  }
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) {
    const err = new Error('dueDate must parse to a valid date');
    err.status = 400;
    throw err;
  }
  return { value: d, set: true };
}

// Reject non-UUID task ids up front. work_tasks.id is UUID, so a numeric /
// legacy id (e.g. an offboarding termination id mis-routed from a `queue`
// notification into the work_tasks drawer) bound to $1 throws Postgres 22P02
// `invalid input syntax for type uuid`. A non-UUID id can never match a
// work_tasks row, so 404 is the correct, non-throwing answer. See 2026-06-10.
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

async function fetchTaskRow(taskId) {
  const { rows } = await query(
    `SELECT id, org_node_id, title, description, status, priority,
            creator_email, assignee_emails, follower_emails,
            project_id, parent_task_id, due_date, started_at, completed_at,
            tags, source, source_id, external_url, is_archived,
            created_at, updated_at
       FROM work_tasks WHERE id = $1 LIMIT 1`,
    [taskId],
  );
  return rows[0] || null;
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { taskId } = await params;
  if (!isUuid(taskId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const existing = await fetchTaskRow(taskId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const deptId = await getCurrentDeptId(user, req);
  if (existing.org_node_id && deptId && existing.org_node_id !== deptId) {
    return NextResponse.json({ error: 'Forbidden — task belongs to a different department' }, { status: 403 });
  }

  const task = rowToTask(existing);

  // 2026-05-25 — stakeholder-only read scope. Caller must be the
  // creator, an assignee, OR a follower. Dept admins (canManageOrgNode)
  // retain access so manage-the-org workflows aren't blocked. 404
  // instead of 403 so a non-stakeholder can't probe the existence of
  // tasks they aren't on. Mirrors the GET list filter in route.js.
  const lcEmail = user.email.toLowerCase();
  const isStakeholder =
    (task.creator?.email || '').toLowerCase() === lcEmail
    || (task.assignees || []).some(e => String(e).toLowerCase() === lcEmail)
    || (task.followers || []).some(e => String(e).toLowerCase() === lcEmail);
  const isDeptAdminEarly = task.orgNodeId ? await canManageOrgNode(user, task.orgNodeId) : false;
  if (!isStakeholder && !isDeptAdminEarly) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Hydrate comments + activity for the detail pane.
  try {
    const [commentsRes, activityRes] = await Promise.all([
      query(
        `SELECT id, task_id, author_email, author_name, body, mention_emails, created_at, edited_at
           FROM work_task_comments WHERE task_id = $1
           ORDER BY created_at ASC LIMIT 500`,
        [taskId],
      ),
      query(
        `SELECT id, task_id, actor_email, actor_name, event_type, payload, created_at
           FROM work_task_activity WHERE task_id = $1
           ORDER BY created_at DESC LIMIT 200`,
        [taskId],
      ),
    ]);
    const comments = commentsRes.rows.map(rowToComment);
    const activity = activityRes.rows.map(r => ({
      id: r.id,
      actor: { email: r.actor_email, name: r.actor_name || null },
      eventType: r.event_type,
      payload: r.payload || null,
      createdAt: r.created_at,
    }));
    const oooEmails = await fetchOooEmails(
      Array.from(new Set([...(task.assignees || []), ...(task.followers || [])])),
    );

    // Reuse the dept-admin check computed above for the stakeholder gate
    // so we don't issue a duplicate canManageOrgNode lookup per GET.
    const canEdit = canEditWorkTask(user, task, { isDeptAdmin: isDeptAdminEarly });

    return NextResponse.json({ task, comments, activity, oooEmails, canEdit });
  } catch (err) {
    console.error('[work-tasks/:id GET]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { taskId } = await params;
  if (!isUuid(taskId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const existing = await fetchTaskRow(taskId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const existingTask = rowToTask(existing);
  const isDeptAdmin = existing.org_node_id ? await canManageOrgNode(user, existing.org_node_id) : false;
  if (!canEditWorkTask(user, existingTask, { isDeptAdmin })) {
    return NextResponse.json({ error: 'Forbidden — only the creator, assignees, followers, or a department admin can edit this task' }, { status: 403 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const sets = [];
  const values = [];
  let i = 1;
  const patchedFields = [];

  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const t = String(body.title || '').trim().slice(0, TASK_NAME_MAX);
    if (!t) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    sets.push(`title = $${i++}`); values.push(t); patchedFields.push('title');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const v = body.description == null ? null : String(body.description).slice(0, TASK_DESCRIPTION_MAX);
    sets.push(`description = $${i++}`); values.push(v); patchedFields.push('description');
  }
  let newStatus = null;
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    if (!VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    newStatus = body.status;
    sets.push(`status = $${i++}`); values.push(newStatus); patchedFields.push('status');
    if (newStatus === 'in_progress' && !existing.started_at) {
      sets.push(`started_at = $${i++}`); values.push(new Date());
    }
    if (newStatus === 'done') {
      sets.push(`completed_at = $${i++}`); values.push(new Date());
    } else if (existing.status === 'done' && newStatus !== 'done') {
      sets.push(`completed_at = $${i++}`); values.push(null);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
    if (!VALID_PRIORITIES.has(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    sets.push(`priority = $${i++}`); values.push(body.priority); patchedFields.push('priority');
  }
  let newAssignees = null;
  if (Object.prototype.hasOwnProperty.call(body, 'assignees')) {
    try {
      newAssignees = await validateRosterEmails(body.assignees, { max: MAX_ASSIGNEES, label: 'assignees' });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    sets.push(`assignee_emails = $${i++}`); values.push(newAssignees); patchedFields.push('assignees');
  }
  let newFollowers = null;
  if (Object.prototype.hasOwnProperty.call(body, 'followers')) {
    try {
      newFollowers = await validateRosterEmails(body.followers, { max: MAX_FOLLOWERS, label: 'followers' });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    sets.push(`follower_emails = $${i++}`); values.push(newFollowers); patchedFields.push('followers');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dueDate')) {
    let parsed;
    try { parsed = parseDueDate(body.dueDate); }
    catch (err) { return NextResponse.json({ error: err.message }, { status: err.status || 400 }); }
    sets.push(`due_date = $${i++}`); values.push(parsed.value); patchedFields.push('dueDate');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
    sets.push(`tags = $${i++}`); values.push(normaliseTags(body.tags)); patchedFields.push('tags');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'projectId')) {
    sets.push(`project_id = $${i++}`); values.push(body.projectId || null); patchedFields.push('projectId');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'externalUrl')) {
    const v = body.externalUrl ? String(body.externalUrl).slice(0, 2000) : null;
    sets.push(`external_url = $${i++}`); values.push(v); patchedFields.push('externalUrl');
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }
  sets.push(`updated_at = NOW()`);
  values.push(taskId);

  try {
    const { rows } = await query(
      `UPDATE work_tasks SET ${sets.join(', ')}
        WHERE id = $${i}
        RETURNING id, org_node_id, title, description, status, priority,
                  creator_email, assignee_emails, follower_emails,
                  project_id, parent_task_id, due_date, started_at, completed_at,
                  tags, source, source_id, external_url, is_archived,
                  created_at, updated_at`,
      values,
    );
    const after = rowToTask(rows[0]);

    // Activity log
    await recordTaskActivity({
      taskId: after.id,
      actor: { email: user.email, name: user.name || null },
      eventType: 'update',
      payload: {
        patchedFields,
        before: {
          status: existing.status,
          priority: existing.priority,
          assignees: existing.assignee_emails || [],
          followers: existing.follower_emails || [],
          dueDate: existing.due_date,
        },
        after: {
          status: after.status,
          priority: after.priority,
          assignees: after.assignees,
          followers: after.followers,
          dueDate: after.dueDate,
        },
      },
    });

    // Notifications — status change
    if (newStatus && newStatus !== existing.status) {
      const stakeholders = taskStakeholders(after);
      const statusLabels = {
        todo: 'reopened (todo)',
        in_progress: 'in progress',
        blocked: 'blocked',
        done: 'done',
        archived: 'archived',
      };
      await fanOutTaskNotifications({
        recipients: stakeholders,
        excludeEmail: user.email.toLowerCase(),
        type: 'task_status_change',
        title: `${user.name || user.email} marked a task ${statusLabels[newStatus] || newStatus}`,
        body: after.title,
        taskId: after.id,
        sourceType: 'work_task',
        sourceId: after.id,
        actor: { email: user.email, name: user.name || null },
      });
    }

    // Notifications — assignee delta
    if (newAssignees) {
      const prev = new Set((existing.assignee_emails || []).map(e => String(e).toLowerCase()));
      const next = new Set(newAssignees.map(e => String(e).toLowerCase()));
      const added = [...next].filter(e => !prev.has(e));
      const removed = [...prev].filter(e => !next.has(e));
      if (added.length > 0) {
        await fanOutTaskNotifications({
          recipients: added,
          excludeEmail: user.email.toLowerCase(),
          type: 'task_assigned',
          title: `${user.name || user.email} assigned you a task`,
          body: after.title,
          taskId: after.id,
          sourceType: 'work_task',
          sourceId: after.id,
          actor: { email: user.email, name: user.name || null },
        });
      }
      if (removed.length > 0) {
        await fanOutTaskNotifications({
          recipients: removed,
          excludeEmail: user.email.toLowerCase(),
          type: 'task_unassigned',
          title: `${user.name || user.email} removed you from a task`,
          body: after.title,
          taskId: after.id,
          sourceType: 'work_task',
          sourceId: after.id,
          actor: { email: user.email, name: user.name || null },
        });
      }
    }

    return NextResponse.json({ task: after });
  } catch (err) {
    console.error('[work-tasks/:id PATCH]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { taskId } = await params;
  if (!isUuid(taskId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const existing = await fetchTaskRow(taskId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const existingTask = rowToTask(existing);
  const isDeptAdmin = existing.org_node_id ? await canManageOrgNode(user, existing.org_node_id) : false;
  if (!canEditWorkTask(user, existingTask, { isDeptAdmin })) {
    return NextResponse.json({ error: 'Forbidden — only the creator, assignees, followers, or a department admin can archive this task' }, { status: 403 });
  }

  try {
    await query(
      `UPDATE work_tasks SET is_archived = true, status = 'archived', updated_at = NOW()
        WHERE id = $1 AND is_archived = false`,
      [taskId],
    );
    await recordTaskActivity({
      taskId,
      actor: { email: user.email, name: user.name || null },
      eventType: 'archive',
    });
    return NextResponse.json({ archived: true });
  } catch (err) {
    console.error('[work-tasks/:id DELETE]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

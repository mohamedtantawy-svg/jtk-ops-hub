// ── /api/v1/work-tasks (Phase 1, 2026-05-25) ───────────────────────────────
// GET  — list work tasks scoped to the caller's dept. Optional filters:
//          ?status=  ?priority=  ?scope=mine|assigned|followed|all
//          ?q=       ?project_id=   ?include_archived=1
//        Always returns oooEmails (server-resolved) so the FE can render
//        "On leave" badges without a second roundtrip.
// POST — create a task. Body: { title, description?, priority?, status?,
//          assignees?, followers?, dueDate?, tags?, projectId?, parentTaskId?,
//          source?, sourceId?, externalUrl? }.
//        Stamps creator + creator's dept. Sends task_assigned notifications
//        to every assignee (except the creator) on create.

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { getCurrentDeptId } from '../../../../src/lib/dept-scope';
import {
  rowToTask,
  validateRosterEmails,
  normaliseEmail,
  normaliseTags,
  fetchOooEmails,
  fanOutTaskNotifications,
  recordTaskActivity,
  migratePersonalChecklistIfNeeded,
  VALID_STATUSES,
  VALID_PRIORITIES,
  TASK_NAME_MAX,
  TASK_DESCRIPTION_MAX,
  MAX_ASSIGNEES,
  MAX_FOLLOWERS,
  computeDueDateFromPriority,
} from '../../../../src/lib/work-tasks-helpers';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const VALID_SOURCES = new Set([
  'manual', 'slack', 'hr_hub', 'leader_alert', 'queue', 'imported_checklist',
]);
const VALID_SCOPES = new Set(['mine', 'assigned', 'followed', 'all']);

function parseDueDate(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    const err = new Error('dueDate must be an ISO string or epoch ms');
    err.status = 400;
    throw err;
  }
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) {
    const err = new Error('dueDate must parse to a valid date');
    err.status = 400;
    throw err;
  }
  return d;
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deptId = await getCurrentDeptId(user, req);
  if (!deptId) {
    // User has no dept — return empty list rather than 500.
    return NextResponse.json({ tasks: [], oooEmails: [], dept: null });
  }

  // Phase 2 (2026-05-25): silent one-time migration of the user's
  // PersonalChecklist into work_tasks. The helper short-circuits on a
  // sentinel after the first run so this stays cheap on every subsequent
  // request. Errors inside the migration don't block the list response --
  // they're logged and the user still sees whatever's already in
  // work_tasks. Run BEFORE the list query so the freshly-migrated rows
  // appear in the same response as the legacy checklist used to.
  try {
    await migratePersonalChecklistIfNeeded(user.email, deptId);
  } catch (err) {
    console.warn('[work-tasks GET] migration step failed:', err?.message);
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const priority = searchParams.get('priority');
  const scope = searchParams.get('scope') || 'all';
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const projectId = searchParams.get('project_id');
  const includeArchived = searchParams.get('include_archived') === '1';
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get('limit')) || DEFAULT_LIMIT));

  if (status && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (priority && !VALID_PRIORITIES.has(priority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
  }
  if (scope && !VALID_SCOPES.has(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }

  const lcEmail = user.email.toLowerCase();

  const whereParts = ['t.org_node_id = $1'];
  const values = [deptId];
  if (!includeArchived) {
    whereParts.push("t.is_archived = false AND t.status <> 'archived'");
  }
  if (status) {
    values.push(status);
    whereParts.push(`t.status = $${values.length}`);
  }
  if (priority) {
    values.push(priority);
    whereParts.push(`t.priority = $${values.length}`);
  }
  if (projectId) {
    values.push(projectId);
    whereParts.push(`t.project_id = $${values.length}`);
  }
  // Scope is layered on top of dept-scope.
  if (scope === 'mine') {
    values.push(lcEmail);
    whereParts.push(`LOWER(t.creator_email) = $${values.length}`);
  } else if (scope === 'assigned') {
    values.push(lcEmail);
    whereParts.push(`$${values.length} = ANY(t.assignee_emails)`);
  } else if (scope === 'followed') {
    values.push(lcEmail);
    whereParts.push(`$${values.length} = ANY(t.follower_emails)`);
  }
  if (q) {
    values.push(`%${q.replace(/[%_]/g, m => '\\' + m)}%`);
    const i = values.length;
    whereParts.push(`(LOWER(t.title) LIKE $${i} OR LOWER(COALESCE(t.description, '')) LIKE $${i})`);
  }

  values.push(limit);
  const sql = `
    SELECT t.id, t.org_node_id, t.title, t.description, t.status, t.priority,
           t.creator_email, t.assignee_emails, t.follower_emails,
           t.project_id, t.parent_task_id, t.due_date, t.started_at, t.completed_at,
           t.tags, t.source, t.source_id, t.external_url, t.is_archived,
           t.created_at, t.updated_at,
           (SELECT COUNT(*)::int FROM work_task_comments c WHERE c.task_id = t.id) AS comment_count
      FROM work_tasks t
     WHERE ${whereParts.join(' AND ')}
     ORDER BY
       CASE t.status WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'todo' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
       COALESCE(t.due_date, t.created_at + interval '30 days') ASC,
       t.created_at DESC
     LIMIT $${values.length}
  `;
  try {
    const { rows } = await query(sql, values);
    const tasks = rows.map(rowToTask);
    const allEmails = Array.from(new Set(
      tasks.flatMap(t => [...(t.assignees || []), ...(t.followers || [])]),
    ));
    const oooEmails = await fetchOooEmails(allEmails);
    return NextResponse.json({ tasks, oooEmails, dept: { id: deptId } });
  } catch (err) {
    console.error('[work-tasks GET]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deptId = await getCurrentDeptId(user, req);
  if (!deptId) {
    return NextResponse.json({ error: 'No department resolved for your account' }, { status: 400 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const title = String(body?.title || '').trim().slice(0, TASK_NAME_MAX);
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const description = body?.description == null
    ? null
    : String(body.description).slice(0, TASK_DESCRIPTION_MAX);
  const priority = body?.priority && VALID_PRIORITIES.has(body.priority) ? body.priority : 'normal';
  const status = body?.status && VALID_STATUSES.has(body.status) ? body.status : 'todo';
  const source = body?.source && VALID_SOURCES.has(body.source) ? body.source : 'manual';
  const sourceId = body?.sourceId ? String(body.sourceId).slice(0, 255) : null;
  const externalUrl = body?.externalUrl ? String(body.externalUrl).slice(0, 2000) : null;
  const projectId = body?.projectId || null;
  const parentTaskId = body?.parentTaskId || null;

  let assignees, followers;
  try {
    assignees = await validateRosterEmails(body?.assignees, { max: MAX_ASSIGNEES, label: 'assignees' });
    followers = await validateRosterEmails(body?.followers, { max: MAX_FOLLOWERS, label: 'followers' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 400 });
  }

  // Default to the creator being the sole assignee — captures the most
  // common case (personal todo) without making the user fill the picker.
  const creatorEmail = user.email.toLowerCase();
  if (assignees.length === 0) {
    assignees = [creatorEmail];
  }

  let dueDate;
  try { dueDate = parseDueDate(body?.dueDate); }
  catch (err) { return NextResponse.json({ error: err.message }, { status: err.status || 400 }); }

  const now = new Date();
  const effectiveDueDate = dueDate || computeDueDateFromPriority(now.getTime(), priority);
  const tags = normaliseTags(body?.tags);

  try {
    const { rows } = await query(
      `INSERT INTO work_tasks (
         org_node_id, title, description, status, priority, creator_email,
         assignee_emails, follower_emails, project_id, parent_task_id,
         due_date, started_at, tags, source, source_id, external_url
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, org_node_id, title, description, status, priority,
                 creator_email, assignee_emails, follower_emails,
                 project_id, parent_task_id, due_date, started_at, completed_at,
                 tags, source, source_id, external_url, is_archived,
                 created_at, updated_at`,
      [
        deptId, title, description, status, priority, creatorEmail,
        assignees, followers, projectId, parentTaskId,
        effectiveDueDate, status === 'in_progress' ? now : null,
        tags, source, sourceId, externalUrl,
      ],
    );
    const task = rowToTask(rows[0]);

    // Activity: creation log.
    await recordTaskActivity({
      taskId: task.id,
      actor: { email: user.email, name: user.name || null },
      eventType: 'create',
      payload: { title, priority, status, assignees, followers, dueDate: task.dueDate },
    });

    // Notify assignees that they were assigned (excluding the creator
    // since they presumably know about their own create).
    if (assignees.length > 0) {
      await fanOutTaskNotifications({
        recipients: assignees,
        excludeEmail: creatorEmail,
        type: 'task_assigned',
        title: `${user.name || creatorEmail} assigned you a task`,
        body: title,
        taskId: task.id,
        sourceType: 'work_task',
        sourceId: task.id,
        actor: { email: user.email, name: user.name || null },
      });
    }

    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    console.error('[work-tasks POST]', err?.message);
    if (err.code === '23503') {
      return NextResponse.json({ error: 'Referenced project or parent task not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

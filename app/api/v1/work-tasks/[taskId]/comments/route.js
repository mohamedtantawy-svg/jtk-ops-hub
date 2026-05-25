// ── /api/v1/work-tasks/[taskId]/comments (Phase 1, 2026-05-25) ─────────────
// GET  — paginated comment thread (default page 1, limit 100, cap 500).
//        Cursor by created_at via ?since=<ISO> for the detail drawer's
//        live-poll (skill section 3.11 polling pattern).
// POST — create a comment. Validates @-mention emails against the live
//        roster. Notifies stakeholders (assignees + followers + creator)
//        with task_commented; separately notifies @mentioned with
//        task_mentioned.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { getCurrentDeptId } from '../../../../../../src/lib/dept-scope';
import {
  rowToComment,
  rowToTask,
  validateRosterEmails,
  fanOutTaskNotifications,
  recordTaskActivity,
  taskStakeholders,
  TASK_COMMENT_MAX,
} from '../../../../../../src/lib/work-tasks-helpers';

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

  const taskRow = await fetchTaskRow(taskId);
  if (!taskRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const deptId = await getCurrentDeptId(user, req);
  if (taskRow.org_node_id && deptId && taskRow.org_node_id !== deptId) {
    return NextResponse.json({ error: 'Forbidden — task belongs to a different department' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 100));
  const since = searchParams.get('since');

  const values = [taskId];
  let whereSince = '';
  if (since) {
    const d = new Date(since);
    if (Number.isFinite(d.getTime())) {
      values.push(d);
      whereSince = ` AND created_at > $${values.length}`;
    }
  }
  values.push(limit);

  try {
    const { rows } = await query(
      `SELECT id, task_id, author_email, author_name, body, mention_emails, created_at, edited_at
         FROM work_task_comments
        WHERE task_id = $1${whereSince}
        ORDER BY created_at ASC
        LIMIT $${values.length}`,
      values,
    );
    return NextResponse.json({ comments: rows.map(rowToComment) });
  } catch (err) {
    console.error('[work-tasks/:id/comments GET]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { taskId } = await params;

  const taskRow = await fetchTaskRow(taskId);
  if (!taskRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const deptId = await getCurrentDeptId(user, req);
  if (taskRow.org_node_id && deptId && taskRow.org_node_id !== deptId) {
    return NextResponse.json({ error: 'Forbidden — task belongs to a different department' }, { status: 403 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = String(body?.body || '').trim();
  if (!text) return NextResponse.json({ error: 'body is required' }, { status: 400 });
  if (text.length > TASK_COMMENT_MAX) {
    return NextResponse.json({ error: `body cannot exceed ${TASK_COMMENT_MAX} characters` }, { status: 400 });
  }

  let mentions;
  try {
    mentions = await validateRosterEmails(body?.mentions, { max: 24, label: 'mentions' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 400 });
  }

  try {
    const { rows } = await query(
      `INSERT INTO work_task_comments (task_id, author_email, author_name, body, mention_emails)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, task_id, author_email, author_name, body, mention_emails, created_at, edited_at`,
      [taskId, user.email.toLowerCase(), user.name || null, text, mentions],
    );
    const comment = rowToComment(rows[0]);

    const task = rowToTask(taskRow);
    const stakeholders = taskStakeholders(task);
    const actor = { email: user.email, name: user.name || null };

    // task_commented to stakeholders (excluding the author + everyone
    // already getting a more specific task_mentioned ping below).
    const mentionSet = new Set(mentions.map(e => e.toLowerCase()));
    const stakeholderRecipients = stakeholders.filter(e => !mentionSet.has(e));
    if (stakeholderRecipients.length > 0) {
      await fanOutTaskNotifications({
        recipients: stakeholderRecipients,
        excludeEmail: user.email.toLowerCase(),
        type: 'task_commented',
        title: `${user.name || user.email} commented on a task`,
        body: text.slice(0, 200),
        taskId: task.id,
        sourceType: 'work_task_comment',
        sourceId: comment.id,
        actor,
      });
    }
    if (mentions.length > 0) {
      await fanOutTaskNotifications({
        recipients: mentions,
        excludeEmail: user.email.toLowerCase(),
        type: 'task_mentioned',
        title: `${user.name || user.email} mentioned you on a task`,
        body: text.slice(0, 200),
        taskId: task.id,
        sourceType: 'work_task_comment',
        sourceId: comment.id,
        actor,
      });
    }

    // Activity log
    await recordTaskActivity({
      taskId,
      actor,
      eventType: 'comment',
      payload: { commentId: comment.id, mentions },
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    console.error('[work-tasks/:id/comments POST]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { requireRole } from '../../../../../../src/lib/auth-helpers';
import {
  canOperateOnTask,
  loadTaskForGuard,
  FORBIDDEN,
} from '../../../../../../src/lib/task-scope-guard';
import { MEMBERS_BY_EMAIL } from '../../../../../../src/data/members';
import { getVisibleMemberEmails, isAdmin } from '../../../../../../src/lib/scope-helpers';

export async function PATCH(req, { params }) {
  try {
    // Only admin, regional_manager, and team_lead can reassign tasks.
    const { authorized, user: authUser, status, error } = requireRole(req, 'admin', 'regional_manager', 'team_lead');
    if (!authorized) return NextResponse.json({ error }, { status });

    const { id } = await params;
    const { assigneeId } = await req.json();

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const whereClause = isUUID ? 'WHERE id = $2' : 'WHERE external_id = $2';

    const result = await withTransaction(async (client) => {
      // 1. Load the task first — cannot reassign a task the caller can't see.
      const task = await loadTaskForGuard(client, id);
      if (!task) return { notFound: true };
      if (!canOperateOnTask(authUser, task)) return { forbidden: true };

      // 2. Validate the target assignee exists and is within the caller's
      //    hierarchy. Null = unassign is always permitted.
      if (assigneeId) {
        const { rows: memRows } = await client.query(
          'SELECT id, email FROM members WHERE id = $1 LIMIT 1',
          [assigneeId],
        );
        if (memRows.length === 0) return { invalidAssignee: 'Unknown member' };
        const assigneeEmail = (memRows[0].email || '').toLowerCase();
        const memMeta = MEMBERS_BY_EMAIL[assigneeEmail];
        if (!memMeta) return { invalidAssignee: 'Member not in directory' };
        if (memMeta.active === false) return { invalidAssignee: 'Member is deactivated' };
        if (!isAdmin(authUser)) {
          const visible = getVisibleMemberEmails(authUser);
          if (!visible.has(assigneeEmail)) return { forbiddenAssignee: true };
        }
      }

      const { rows } = await client.query(
        `UPDATE tasks SET assignee_id = $1, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = NOW() ${whereClause} RETURNING *`,
        [assigneeId || null, id]
      );
      if (rows.length === 0) return { notFound: true };

      await client.query(
        'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
        [rows[0].id, 'assign', `Assigned to member ${assigneeId}`, authUser.name || 'System']
      );

      return { row: rows[0] };
    });

    if (result?.forbidden) return NextResponse.json(FORBIDDEN, { status: 403 });
    if (result?.forbiddenAssignee) return NextResponse.json({ error: 'Assignee outside your scope', reason: 'assignee_scope' }, { status: 403 });
    if (result?.invalidAssignee) return NextResponse.json({ error: result.invalidAssignee, reason: 'assignee_invalid' }, { status: 400 });
    if (result?.notFound || !result?.row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true, assigneeId: result.row.assignee_id });
  } catch (err) {
    console.error('[tasks/assign]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

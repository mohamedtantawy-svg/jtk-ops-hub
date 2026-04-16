import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { requireRole } from '../../../../../../src/lib/auth-helpers';

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
      const { rows } = await client.query(
        `UPDATE tasks SET assignee_id = $1, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = NOW() ${whereClause} RETURNING *`,
        [assigneeId || null, id]
      );
      if (rows.length === 0) return null;

      await client.query(
        'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
        [rows[0].id, 'assign', `Assigned to member ${assigneeId}`, authUser.name || 'System']
      );

      return rows[0];
    });

    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true, assigneeId: result.assignee_id });
  } catch (err) {
    console.error('[tasks/assign]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

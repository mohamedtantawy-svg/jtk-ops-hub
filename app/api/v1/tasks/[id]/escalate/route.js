import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

export async function PATCH(req, { params }) {
  try {
    const authUser = getAuthUser(req);
    const { id } = await params;
    const { managerId, reason } = await req.json();

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const whereClause = isUUID ? 'WHERE id = $1' : 'WHERE external_id = $1';

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE tasks SET status = 'escalated', updated_at = NOW() ${whereClause} RETURNING *`,
        [id]
      );
      if (rows.length === 0) return null;

      // Create escalation record
      const { rows: [escalation] } = await client.query(
        `INSERT INTO escalations (task_id, subject, reason, escalated_by, manager_id, escalation_source)
         VALUES ($1, $2, $3, $4, $5, 'ticket') RETURNING *`,
        [rows[0].id, rows[0].subject, reason, authUser.name || 'System', managerId]
      );

      await client.query(
        'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
        [rows[0].id, 'escalate', `Escalated: ${reason}`, authUser.name || 'System']
      );

      return { task: rows[0], escalation };
    });

    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[tasks/escalate]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

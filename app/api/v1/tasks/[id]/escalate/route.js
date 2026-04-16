import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

export async function PATCH(req, { params }) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

      // Create escalation record — also persist the caller's identity so the
      // scoping filter on GET /escalations can match the raiser.
      const { rows: [escalation] } = await client.query(
        `INSERT INTO escalations
           (task_id, subject, reason,
            escalated_by, escalated_by_email, escalated_by_id,
            manager_id, manager_name,
            escalation_source)
         VALUES ($1, $2, $3,
                 $4, $5, $6,
                 $7, (SELECT name FROM members WHERE id = $7),
                 'ticket')
         RETURNING *`,
        [
          rows[0].id, rows[0].subject, reason,
          authUser.name || 'System', authUser.email || null, authUser.id || null,
          managerId,
        ]
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

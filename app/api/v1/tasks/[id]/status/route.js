import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

const VALID_STATUSES = ['open', 'in_progress', 'escalated', 'snoozed', 'resolved', 'closed'];

// Authorization note: All authenticated users (including agents) can change
// task status. Agents need this to resolve/close their own tasks. This is
// intentional — the auth check below only verifies the user is logged in.
export async function PATCH(req, { params }) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const { status } = await req.json();
    if (!status) return NextResponse.json({ error: 'Status required' }, { status: 400 });

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const whereClause = isUUID ? 'WHERE id = $2' : 'WHERE external_id = $2';

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE tasks SET status = $1, updated_at = NOW() ${whereClause} RETURNING *`,
        [status, id]
      );
      if (rows.length === 0) return null;

      // Log activity
      await client.query(
        'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
        [rows[0].id, 'status', `Status changed to ${status}`, authUser.name || 'System']
      );

      return rows[0];
    });

    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true, status: result.status });
  } catch (err) {
    console.error('[tasks/status]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

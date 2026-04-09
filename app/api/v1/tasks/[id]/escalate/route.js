import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const { managerId, reason } = await req.json();

    const { rows } = await query(
      'UPDATE tasks SET status = \'escalated\', updated_at = NOW() WHERE id = $1 OR external_id = $1 RETURNING *',
      [id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Create escalation record
    await query(
      `INSERT INTO escalations (task_id, subject, reason, escalated_by, manager_id, escalation_source)
       VALUES ($1, $2, $3, $4, $5, 'ticket')`,
      [rows[0].id, rows[0].subject, reason, 'System', managerId]
    );

    await query(
      'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
      [rows[0].id, 'escalate', `Escalated: ${reason}`, 'System']
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[tasks/escalate]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

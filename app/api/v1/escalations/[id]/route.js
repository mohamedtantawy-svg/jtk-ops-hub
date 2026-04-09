import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { rows } = await query('SELECT * FROM escalations WHERE id = $1', [id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const r = rows[0];
    return NextResponse.json({
      id: r.id, taskId: r.task_id, subject: r.subject, reason: r.reason,
      escalatedBy: r.escalated_by, escalatedAt: r.escalated_at,
      managerId: r.manager_id, managerName: r.manager_name,
      status: r.status, managerResponseStatus: r.manager_response_status,
      managerResponse: r.manager_response, managerRespondedAt: r.manager_responded_at,
      managerRespondedBy: r.manager_responded_by, escalationSource: r.escalation_source,
      slackChannel: r.slack_channel, slackUser: r.slack_user,
    });
  } catch (err) {
    console.error('[escalations/id GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

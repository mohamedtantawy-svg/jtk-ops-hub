import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const managerId = searchParams.get('managerId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) { whereSql += ` AND status = $${idx++}`; params.push(status); }
    if (managerId) { whereSql += ` AND manager_id = $${idx++}`; params.push(managerId); }

    const countSql = 'SELECT COUNT(*) FROM escalations' + whereSql;
    const dataSql = 'SELECT id, task_id, subject, reason, escalated_by, escalated_at, manager_id, manager_name, status, manager_response_status, manager_response, manager_responded_at, manager_responded_by, escalation_source, slack_channel, slack_user, slack_message_url FROM escalations' + whereSql + ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const [{ rows }, countResult] = await Promise.all([
      query(dataSql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    const items = rows.map(r => ({
      id: r.id, taskId: r.task_id, subject: r.subject, reason: r.reason,
      escalatedBy: r.escalated_by, escalatedAt: r.escalated_at,
      managerId: r.manager_id, managerName: r.manager_name,
      status: r.status, managerResponseStatus: r.manager_response_status,
      managerResponse: r.manager_response, managerRespondedAt: r.manager_responded_at,
      managerRespondedBy: r.manager_responded_by, escalationSource: r.escalation_source,
      slackChannel: r.slack_channel, slackUser: r.slack_user, slackMessageUrl: r.slack_message_url,
    }));

    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[escalations GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { taskId, subject, reason, managerId } = await req.json();
    if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 });

    const { rows } = await query(
      `INSERT INTO escalations (task_id, subject, reason, escalated_by, manager_id, manager_name)
       VALUES ($1, $2, $3, $4, $5, (SELECT name FROM members WHERE id = $5))
       RETURNING *`,
      [taskId || null, subject || '', reason, 'User', managerId || null]
    );

    const r = rows[0];
    return NextResponse.json({
      id: r.id, taskId: r.task_id, subject: r.subject, reason: r.reason,
      escalatedBy: r.escalated_by, escalatedAt: r.escalated_at,
      managerId: r.manager_id, managerName: r.manager_name, status: r.status,
      managerResponseStatus: r.manager_response_status,
    }, { status: 201 });
  } catch (err) {
    console.error('[escalations POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

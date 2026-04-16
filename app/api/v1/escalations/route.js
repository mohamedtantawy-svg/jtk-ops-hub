import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { getVisibleMemberEmails, isAdmin } from '../../../../src/lib/scope-helpers';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const managerId = searchParams.get('managerId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    // Base SELECT joins manager + task's assignee so we can filter by email scope.
    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status)    { whereSql += ` AND e.status = $${idx++}`; params.push(status); }
    if (managerId) { whereSql += ` AND e.manager_id = $${idx++}`; params.push(managerId); }

    // Role-based scope — admins see everything, everyone else sees escalations
    // either raised by OR assigned (manager) to someone in their visible set.
    if (!isAdmin(user)) {
      const visible = Array.from(getVisibleMemberEmails(user)).map(e => e.toLowerCase());
      // Always include the caller's own email defensively in case they aren't
      // in the hardcoded directory yet.
      if (user.email && !visible.includes(user.email.toLowerCase())) {
        visible.push(user.email.toLowerCase());
      }
      whereSql += ` AND (
           LOWER(e.escalated_by_email) = ANY($${idx})
        OR LOWER(asm.email)            = ANY($${idx})
      )`;
      params.push(visible);
      idx++;
    }

    const countSql = `
      SELECT COUNT(*)
        FROM escalations e
        LEFT JOIN members asm ON asm.id = e.manager_id
      ${whereSql}
    `;
    const dataSql = `
      SELECT e.id, e.task_id, e.subject, e.reason,
             e.escalated_by, e.escalated_by_email, e.escalated_by_id,
             e.escalated_at,
             e.manager_id, e.manager_name,
             e.status, e.manager_response_status, e.manager_response,
             e.manager_responded_at, e.manager_responded_by,
             e.escalation_source, e.slack_channel, e.slack_user, e.slack_message_url,
             e.severity, e.resolved_at, e.resolved_by,
             e.created_at, e.updated_at
        FROM escalations e
        LEFT JOIN members asm ON asm.id = e.manager_id
      ${whereSql}
       ORDER BY e.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}
    `;
    const dataParams = [...params, limit, offset];

    const [{ rows }, countResult] = await Promise.all([
      query(dataSql, dataParams),
      query(countSql, params),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    const items = rows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      subject: r.subject,
      reason: r.reason,
      escalatedBy:      r.escalated_by,
      escalatedByEmail: r.escalated_by_email,
      escalatedById:    r.escalated_by_id,
      escalatedAt:      r.escalated_at,
      managerId:        r.manager_id,
      managerName:      r.manager_name,
      status:           r.status,
      managerResponseStatus: r.manager_response_status,
      managerResponse:       r.manager_response,
      managerRespondedAt:    r.manager_responded_at,
      managerRespondedBy:    r.manager_responded_by,
      escalationSource: r.escalation_source,
      slackChannel:     r.slack_channel,
      slackUser:        r.slack_user,
      slackMessageUrl:  r.slack_message_url,
      severity:         r.severity,
      resolvedAt:       r.resolved_at,
      resolvedBy:       r.resolved_by,
      createdAt:        r.created_at,
      updatedAt:        r.updated_at,
    }));

    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[escalations GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const {
      taskId, subject, reason, managerId,
      escalationSource, slackChannel, slackUser, slackMessageUrl,
      severity,
    } = body;
    if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 });

    const { rows } = await query(
      `INSERT INTO escalations
         (task_id, subject, reason,
          escalated_by, escalated_by_email, escalated_by_id,
          manager_id, manager_name,
          escalation_source, slack_channel, slack_user, slack_message_url,
          severity)
       VALUES ($1, $2, $3,
               $4, $5, $6,
               $7, (SELECT name FROM members WHERE id = $7),
               $8, $9, $10, $11,
               $12)
       RETURNING *`,
      [
        taskId || null, subject || '', reason,
        user.name || user.email || 'User', user.email || null, user.id || null,
        managerId || null,
        escalationSource || 'manual',
        slackChannel || null, slackUser || null, slackMessageUrl || null,
        severity || 'medium',
      ]
    );

    const r = rows[0];
    return NextResponse.json({
      id: r.id,
      taskId: r.task_id,
      subject: r.subject,
      reason: r.reason,
      escalatedBy:      r.escalated_by,
      escalatedByEmail: r.escalated_by_email,
      escalatedById:    r.escalated_by_id,
      escalatedAt:      r.escalated_at,
      managerId:        r.manager_id,
      managerName:      r.manager_name,
      status:           r.status,
      managerResponseStatus: r.manager_response_status,
      escalationSource: r.escalation_source,
      slackChannel:     r.slack_channel,
      slackUser:        r.slack_user,
      slackMessageUrl:  r.slack_message_url,
      severity:         r.severity,
    }, { status: 201 });
  } catch (err) {
    console.error('[escalations POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

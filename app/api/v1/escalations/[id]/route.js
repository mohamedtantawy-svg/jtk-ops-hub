import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getVisibleMemberEmails, isAdmin } from '../../../../../src/lib/scope-helpers';

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const { rows } = await query(
      `SELECT e.*, asm.email AS manager_email
         FROM escalations e
         LEFT JOIN members asm ON asm.id = e.manager_id
        WHERE e.id = $1`,
      [id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const r = rows[0];

    // Visibility check — mirror the list endpoint scoping.
    // Non-admins can only see escalations raised by or assigned to someone
    // in their visible member set.
    if (!isAdmin(user)) {
      const visible = getVisibleMemberEmails(user);
      // Also include the caller's own email defensively
      const visibleLower = new Set([...visible].map(e => e.toLowerCase()));
      if (user.email) visibleLower.add(user.email.toLowerCase());

      const escalatedByEmail = (r.escalated_by_email || '').toLowerCase();
      const managerEmail = (r.manager_email || '').toLowerCase();

      if (!visibleLower.has(escalatedByEmail) && !visibleLower.has(managerEmail)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }

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

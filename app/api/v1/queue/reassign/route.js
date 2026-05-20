// ── POST /api/v1/queue/reassign ──────────────────────────────────────────
// Pushes a reassignment to the original ticketing system (Zendesk or Jira).
// Body: { ticketId: "ZD-12345" | "PROJ-123", assigneeEmail: "someone@deel.com" }
//
// - Open to any authenticated user (2026-05-07): the role gate
//   (admin/RM/TL) was lifted per HR ops feedback so agents can reassign
//   their own cases without round-tripping through a TL. The change
//   is pushed UPSTREAM to Zendesk/Jira on success, so persistence is
//   in the source of truth — subsequent syncs read the new assignee.
// - Busts the persistent `/queue` cache on success so the next poll reflects
//   the new assignee instead of serving a 3-minute-stale response.
// - Upserts a shadow task row keyed by external_id so activity can be logged
//   against a persistent id.
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { reassignTicket } from '../../../../../src/lib/zendesk-api';
import { reassignIssue } from '../../../../../src/lib/jira-api';
import { query } from '../../../../../src/lib/db';
import { cacheDelMany } from '../../../../../src/lib/server-cache';
import { MEMBERS_BY_EMAIL } from '../../../../../src/data/members';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';

async function upsertShadowAndLog({ ticketId, source, assigneeEmail, actorName, orgNodeId }) {
  try {
    // Resolve assignee_id from email (NULL if not a known member)
    const assigneeLookup = await query(
      'SELECT id FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [assigneeEmail],
    );
    const assigneeId = assigneeLookup.rows[0]?.id || null;

    // Phase 11h: shadow rows are born tenanted in the actor's dept. The
    // ON CONFLICT branch does NOT update org_node_id — the row's original
    // dept owns it forever, even if a later actor from a different dept
    // touches it (defends against cross-tenant rewrites).
    const upsert = await query(
      `INSERT INTO tasks (external_id, source, subject, status, assignee_id, org_node_id)
       VALUES ($1, $2, $3, 'in_progress', $4, $5)
       ON CONFLICT (external_id) DO UPDATE
         SET assignee_id = EXCLUDED.assignee_id,
             status = CASE WHEN tasks.status = 'resolved' THEN tasks.status ELSE 'in_progress' END,
             updated_at = NOW()
       RETURNING id`,
      [ticketId, source, ticketId, assigneeId, orgNodeId],
    );
    const taskUuid = upsert.rows[0]?.id;
    if (!taskUuid) return;
    await query(
      'INSERT INTO task_activity (task_id, event_type, event_text, actor_name) VALUES ($1, $2, $3, $4)',
      [taskUuid, 'assign', `Reassigned to ${assigneeEmail}`, actorName || 'System'],
    );
  } catch (err) {
    // Activity logging is best-effort — never fail the reassign because of it
    console.warn('[reassign] Shadow task / activity log failed:', err.message);
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { ticketId, assigneeEmail } = body || {};

  if (!ticketId || !assigneeEmail) {
    return NextResponse.json(
      { error: 'Missing required fields: ticketId, assigneeEmail' },
      { status: 400 },
    );
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(assigneeEmail)) {
    return NextResponse.json(
      { error: 'Invalid email format for assigneeEmail' },
      { status: 400 },
    );
  }

  // Target assignee must be a known active member of the directory. The
  // hierarchy scope check (canAssignTo) was lifted 2026-05-07 — every
  // role can now reassign to anyone in the directory. Directory + active
  // checks remain so we still can't park tickets on a ghost or
  // deactivated row.
  const lc = String(assigneeEmail).toLowerCase();
  const target = MEMBERS_BY_EMAIL[lc];
  if (!target) {
    return NextResponse.json(
      { error: 'Assignee is not a valid member', reason: 'assignee_unknown' },
      { status: 400 },
    );
  }
  if (target.isDeleted === true) {
    return NextResponse.json(
      { error: 'Assignee is deactivated', reason: 'assignee_inactive' },
      { status: 400 },
    );
  }

  try {
    const isZendesk = ticketId.startsWith('ZD-');
    const source = isZendesk ? 'zendesk' : 'jira';

    if (isZendesk) {
      // Strip the "ZD-" prefix to get the numeric Zendesk ticket ID
      const numericId = ticketId.replace('ZD-', '');
      // actAsEmail impersonates the team member so the ticket's audit
      // log records them as the updater instead of the API token owner.
      await reassignTicket(numericId, assigneeEmail, { actAsEmail: user.email });
    } else {
      // Jira issue keys are used as-is (e.g. "PROJ-123")
      await reassignIssue(ticketId, assigneeEmail);
    }

    // Persist + log activity; bust the /queue caches so the next poll picks
    // up the fresh assignee from the source system instead of our stale copy.
    const orgNodeId = await getCurrentDeptId(user, req);
    await upsertShadowAndLog({ ticketId, source, assigneeEmail, actorName: user.name, orgNodeId });
    cacheDelMany(['queue', 'queue_zendesk', 'queue_jira']);

    return NextResponse.json({
      ok: true,
      ticketId,
      assigneeEmail,
      source,
      reassignedBy: user.email,
    });
  } catch (err) {
    console.error('[reassign] Error:', err.message);
    return NextResponse.json(
      { error: 'Reassignment failed' },
      { status: err.status || 500 },
    );
  }
}

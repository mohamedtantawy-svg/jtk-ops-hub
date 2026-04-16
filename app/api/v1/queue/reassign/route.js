// ── POST /api/v1/queue/reassign ──────────────────────────────────────────
// Pushes a reassignment to the original ticketing system (Zendesk or Jira).
// Body: { ticketId: "ZD-12345" | "PROJ-123", assigneeEmail: "someone@deel.com" }
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { reassignTicket } from '../../../../../src/lib/zendesk-api';
import { reassignIssue } from '../../../../../src/lib/jira-api';

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  try {
    const isZendesk = ticketId.startsWith('ZD-');

    if (isZendesk) {
      // Strip the "ZD-" prefix to get the numeric Zendesk ticket ID
      const numericId = ticketId.replace('ZD-', '');
      await reassignTicket(numericId, assigneeEmail);
    } else {
      // Jira issue keys are used as-is (e.g. "PROJ-123")
      await reassignIssue(ticketId, assigneeEmail);
    }

    return NextResponse.json({
      ok: true,
      ticketId,
      assigneeEmail,
      source: isZendesk ? 'zendesk' : 'jira',
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

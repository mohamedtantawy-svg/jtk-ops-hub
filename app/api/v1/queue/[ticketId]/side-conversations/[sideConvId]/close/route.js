// ── POST /api/v1/queue/[ticketId]/side-conversations/[sideConvId]/close ──────
// Closes a side conversation. Re-opening is intentionally not exposed in
// Phase 4 — agents can re-open from Zendesk if needed (rare flow).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../../../../src/lib/roster-server';
import { checkQueueTicketScope } from '../../../../../../../../src/lib/queue-ticket-scope';
import { isZendeskConfigured, closeSideConversation } from '../../../../../../../../src/lib/zendesk-api';

function isZendeskTicket(ticketId) {
  return ticketId.startsWith('ZD-');
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();
  const { ticketId, sideConvId } = await params;
  if (!isZendeskTicket(ticketId)) {
    return NextResponse.json({ error: 'Side conversations are Zendesk-only', reason: 'jira_unsupported' }, { status: 400 });
  }

  const scope = await checkQueueTicketScope(ticketId, user);
  if (!scope.allowed) return NextResponse.json({ error: 'Forbidden', reason: scope.reason }, { status: 403 });

  try {
    const numericId = ticketId.replace('ZD-', '');
    // actAsEmail impersonates the team member so the close action is
    // recorded under their name in the side-conv audit trail.
    await closeSideConversation(numericId, sideConvId, { actAsEmail: user.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[queue/side-conversations/close]', err.message);
    return NextResponse.json({ error: err.message || 'Close failed' }, { status: err.status || 500 });
  }
}

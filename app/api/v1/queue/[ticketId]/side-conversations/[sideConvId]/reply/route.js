// ── POST /api/v1/queue/[ticketId]/side-conversations/[sideConvId]/reply ──────
// Adds a message to an existing side conversation. Body: { body: string }.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../../../../src/lib/roster-server';
import { checkQueueTicketScope } from '../../../../../../../../src/lib/queue-ticket-scope';
import { isZendeskConfigured, replyToSideConversation } from '../../../../../../../../src/lib/zendesk-api';

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

  let body;
  try { body = await req.json(); } catch { body = null; }
  const text = String(body?.body || '').trim();
  if (!text) return NextResponse.json({ error: 'body required' }, { status: 400 });

  try {
    const numericId = ticketId.replace('ZD-', '');
    // actAsEmail impersonates the team member so the side-conv reply
    // shows them as the author, not the API token's owner.
    await replyToSideConversation(
      numericId,
      sideConvId,
      { body: text },
      { actAsEmail: user.email },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[queue/side-conversations/reply]', err.message);
    return NextResponse.json({ error: err.message || 'Reply failed' }, { status: err.status || 500 });
  }
}

// ── /api/v1/queue/[ticketId]/side-conversations ──────────────────────────────
// GET  — list every side conversation on the ticket (id, subject, state,
//        participants, message_count, timestamps).
// POST — create a new side conversation. Body: { subject, body, to: [emails] }
//
// Both routes share the standard scope check via queue-ticket-scope.
// Jira: side conversations are Zendesk-only; both routes return 400 with
// reason: 'jira_unsupported'.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { checkQueueTicketScope } from '../../../../../../src/lib/queue-ticket-scope';
import { isZendeskConfigured, listSideConversations, createSideConversation } from '../../../../../../src/lib/zendesk-api';

function isZendeskTicket(ticketId) {
  return ticketId.startsWith('ZD-');
}

function slimSideConv(sc) {
  return {
    id: sc.id,
    subject: sc.subject || '',
    preview: sc.preview_text || '',
    state: sc.state || 'open',
    messageCount: Number.isFinite(sc.message_count) ? sc.message_count : (Array.isArray(sc.events) ? sc.events.length : 0),
    participants: Array.isArray(sc.participants) ? sc.participants.map(p => ({
      name: p.name || '',
      email: p.email || '',
      role: p.role || '',
    })) : [],
    createdAt: sc.created_at || null,
    updatedAt: sc.updated_at || null,
    url: sc.url || null,
  };
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();
  const { ticketId } = await params;
  if (!isZendeskTicket(ticketId)) {
    return NextResponse.json({ error: 'Side conversations are Zendesk-only', reason: 'jira_unsupported' }, { status: 400 });
  }

  const scope = await checkQueueTicketScope(ticketId, user);
  if (!scope.allowed) return NextResponse.json({ error: 'Forbidden', reason: scope.reason }, { status: 403 });

  try {
    const numericId = ticketId.replace('ZD-', '');
    const res = await listSideConversations(numericId);
    const items = (res?.side_conversations || []).map(slimSideConv);
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[queue/side-conversations]', err.message);
    return NextResponse.json({ error: err.message || 'List failed' }, { status: err.status || 500 });
  }
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();
  const { ticketId } = await params;
  if (!isZendeskTicket(ticketId)) {
    return NextResponse.json({ error: 'Side conversations are Zendesk-only', reason: 'jira_unsupported' }, { status: 400 });
  }

  const scope = await checkQueueTicketScope(ticketId, user);
  if (!scope.allowed) return NextResponse.json({ error: 'Forbidden', reason: scope.reason }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const subject = String(body.subject || '').trim();
  const messageBody = String(body.body || '').trim();
  const to = Array.isArray(body.to)
    ? body.to.map(addr => String(addr || '').trim()).filter(Boolean)
    : [];

  if (!subject) return NextResponse.json({ error: 'subject required' }, { status: 400 });
  if (!messageBody) return NextResponse.json({ error: 'body required' }, { status: 400 });
  if (to.length === 0) return NextResponse.json({ error: 'at least one recipient email required' }, { status: 400 });

  try {
    const numericId = ticketId.replace('ZD-', '');
    // actAsEmail impersonates the team member so the side conversation's
    // creator + first-message author are recorded under their name.
    const res = await createSideConversation(
      numericId,
      { subject, body: messageBody, to },
      { actAsEmail: user.email },
    );
    return NextResponse.json({ ok: true, sideConversation: slimSideConv(res?.side_conversation || {}) });
  } catch (err) {
    console.error('[queue/side-conversations] create:', err.message);
    return NextResponse.json({ error: err.message || 'Create failed' }, { status: err.status || 500 });
  }
}

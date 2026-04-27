// ── GET /api/v1/queue/[ticketId]/side-conversations/[sideConvId] ─────────────
// Fetch a single side conversation with its events (messages). Returns the
// slim shape the FE renders directly: { id, subject, state, messages: [...] }.
// Each message has { id, type, body, htmlBody, from, to, createdAt }.
//
// The Zendesk events endpoint includes both message events and update events
// (state changes, etc.); we filter to messages and surface the relevant
// participant info per event.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../../../src/lib/roster-server';
import { checkQueueTicketScope } from '../../../../../../../src/lib/queue-ticket-scope';
import { isZendeskConfigured, getSideConversation, getSideConversationEvents } from '../../../../../../../src/lib/zendesk-api';

function isZendeskTicket(ticketId) {
  return ticketId.startsWith('ZD-');
}

function shapeMessage(ev) {
  // ZD events have type 'create' | 'reply' | 'state_change' | 'add_attachment' | etc.
  // We surface the message-bearing ones plus state_change so the FE can show
  // a small "closed by … on …" line.
  if (!ev || (ev.type !== 'create' && ev.type !== 'reply')) return null;
  const m = ev.message || {};
  return {
    id: ev.id,
    type: ev.type,
    body: (m.body || '').substring(0, 8000),
    htmlBody: (m.html_body || '').substring(0, 16000),
    from: m.from ? { name: m.from.name || '', email: m.from.email || '' } : null,
    to: Array.isArray(m.to) ? m.to.map(t => ({ name: t.name || '', email: t.email || '' })) : [],
    createdAt: ev.created_at || null,
  };
}

export async function GET(req, { params }) {
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
    const [scRes, evRes] = await Promise.all([
      getSideConversation(numericId, sideConvId),
      getSideConversationEvents(numericId, sideConvId, { per_page: 100 }),
    ]);
    const sc = scRes?.side_conversation || {};
    const messages = (evRes?.events || []).map(shapeMessage).filter(Boolean);
    return NextResponse.json({
      id: sc.id,
      subject: sc.subject || '',
      state: sc.state || 'open',
      participants: Array.isArray(sc.participants) ? sc.participants.map(p => ({
        name: p.name || '', email: p.email || '', role: p.role || '',
      })) : [],
      messages,
      createdAt: sc.created_at || null,
      updatedAt: sc.updated_at || null,
    });
  } catch (err) {
    console.error('[queue/side-conversations/get]', err.message);
    return NextResponse.json({ error: err.message || 'Fetch failed' }, { status: err.status || 500 });
  }
}

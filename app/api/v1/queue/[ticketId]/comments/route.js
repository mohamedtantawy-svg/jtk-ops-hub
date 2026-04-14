import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

const ZD_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || '';
const ZD_TOKEN = process.env.ZENDESK_API_TOKEN || '';
const ZD_EMAIL = process.env.ZENDESK_EMAIL || '';

async function fetchTicketComments(ticketId) {
  if (!ZD_SUBDOMAIN || !ZD_TOKEN) return [];
  const url = `https://${ZD_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}/comments?sort_order=desc&per_page=5`;
  const auth = Buffer.from(`${ZD_EMAIL}/token:${ZD_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.comments || []).map(c => ({
    id: c.id,
    body: (c.body || '').substring(0, 1000),
    htmlBody: (c.html_body || '').substring(0, 2000),
    author: c.author_id,
    public: c.public,
    createdAt: c.created_at,
  }));
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ticketId } = await params;
  const zdId = ticketId.replace('ZD-', '');
  const comments = await fetchTicketComments(zdId);
  return NextResponse.json({ comments });
}

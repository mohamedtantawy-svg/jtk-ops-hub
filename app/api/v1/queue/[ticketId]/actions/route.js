import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

const ZD_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || '';
const ZD_TOKEN = process.env.ZENDESK_API_TOKEN || '';
const ZD_EMAIL = process.env.ZENDESK_EMAIL || '';

async function updateZendeskTicket(ticketId, update) {
  const url = `https://${ZD_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}`;
  const auth = Buffer.from(`${ZD_EMAIL}/token:${ZD_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: update }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zendesk API ${res.status}: ${body.substring(0, 200)}`);
  }
  return res.json();
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ticketId } = await params;
  const zdId = ticketId.replace('ZD-', '');
  const body = await req.json();
  const { action } = body;

  try {
    if (action === 'reply') {
      // Add a public comment (reply to requestor)
      await updateZendeskTicket(zdId, {
        comment: { body: body.message, public: body.public !== false },
      });
      return NextResponse.json({ ok: true, action: 'reply' });
    }

    if (action === 'status') {
      // Change ticket status
      const statusMap = { new: 'new', in_progress: 'open', waiting: 'pending', resolved: 'solved' };
      const zdStatus = statusMap[body.status] || body.status;
      await updateZendeskTicket(zdId, { status: zdStatus });
      return NextResponse.json({ ok: true, action: 'status', status: body.status });
    }

    if (action === 'assignee') {
      // Change assignee (by email - need to look up Zendesk user ID)
      // For now, use assignee_email which Zendesk supports
      await updateZendeskTicket(zdId, { assignee_email: body.assigneeEmail });
      return NextResponse.json({ ok: true, action: 'assignee' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

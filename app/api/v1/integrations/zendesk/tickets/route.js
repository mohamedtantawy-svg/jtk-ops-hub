// ── GET /api/v1/integrations/zendesk/tickets ─────────────────────────────────
// Proxies to Zendesk API: list tickets or get single ticket by id
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listTickets, getTicket, getTicketComments, isZendeskConfigured } from '../../../../../../src/lib/zendesk-api';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk API not configured' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const ticketId = searchParams.get('id');
    const comments = searchParams.get('comments') === 'true';
    const page = searchParams.get('page');
    const perPage = searchParams.get('per_page');
    const sortBy = searchParams.get('sort_by');
    const sortOrder = searchParams.get('sort_order');

    if (ticketId) {
      const result = await getTicket(ticketId);
      if (comments) {
        const cmts = await getTicketComments(ticketId);
        return NextResponse.json({ ...result, comments: cmts.comments });
      }
      return NextResponse.json(result);
    }

    const result = await listTickets({ page, per_page: perPage, sort_by: sortBy, sort_order: sortOrder });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/zendesk/tickets]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

// ── GET /api/v1/integrations/zendesk/search ──────────────────────────────────
// Proxies to Zendesk search API (ticket search)
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { searchTickets, isZendeskConfigured } from '../../../../../../src/lib/zendesk-api';

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
    const query = searchParams.get('query');
    const sortBy = searchParams.get('sort_by');
    const sortOrder = searchParams.get('sort_order');
    const page = searchParams.get('page');
    const perPage = searchParams.get('per_page');

    if (!query) {
      return NextResponse.json({ error: 'query parameter is required' }, { status: 400 });
    }

    const result = await searchTickets(query, { sort_by: sortBy, sort_order: sortOrder, page, per_page: perPage });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/zendesk/search]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

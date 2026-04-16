// ── GET /api/v1/integrations/zendesk/views ───────────────────────────────────
// Proxies to Zendesk Views API (ticket queues / saved views)
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listViews, getViewTickets, isZendeskConfigured } from '../../../../../../src/lib/zendesk-api';

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
    const viewId = searchParams.get('id');
    const page = searchParams.get('page');
    const perPage = searchParams.get('per_page');

    if (viewId) {
      const result = await getViewTickets(viewId, { page, per_page: perPage });
      return NextResponse.json(result);
    }

    const result = await listViews();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/zendesk/views]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

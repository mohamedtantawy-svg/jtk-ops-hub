// ── GET /api/v1/integrations/zendesk/users ───────────────────────────────────
// Proxies to Zendesk Users API
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listUsers, getUser, searchUsers, isZendeskConfigured } from '../../../../../../src/lib/zendesk-api';

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
    const userId = searchParams.get('id');
    const query = searchParams.get('query');
    const page = searchParams.get('page');
    const perPage = searchParams.get('per_page');
    const role = searchParams.get('role');

    if (userId) {
      const result = await getUser(userId);
      return NextResponse.json(result);
    }
    if (query) {
      const result = await searchUsers(query);
      return NextResponse.json(result);
    }

    const result = await listUsers({ page, per_page: perPage, role });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/zendesk/users]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

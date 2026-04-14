// ── GET /api/v1/integrations/zendesk/groups ──────────────────────────────────
// Proxies to Zendesk Groups API (agent teams)
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listGroups, isZendeskConfigured } from '../../../../../../src/lib/zendesk-api';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk API not configured' }, { status: 503 });
  }

  try {
    const result = await listGroups();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/zendesk/groups]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

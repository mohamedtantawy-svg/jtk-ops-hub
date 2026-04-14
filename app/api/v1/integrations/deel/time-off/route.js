// ── GET /api/v1/integrations/deel/time-off ───────────────────────────────────
// Proxies to Deel Admin API: list time-off requests
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listTimeOffRequests, isDeelConfigured } from '../../../../../../src/lib/deel-api';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const result = await listTimeOffRequests({
      contract_id: searchParams.get('contract_id'),
      status: searchParams.get('status'),
      limit: searchParams.get('limit') || '50',
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/deel/time-off]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

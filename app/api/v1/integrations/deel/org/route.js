// ── GET /api/v1/integrations/deel/org ────────────────────────────────────────
// Proxies to Deel Admin API: get organization info
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { getOrganization, isDeelConfigured } from '../../../../../../src/lib/deel-api';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  try {
    const result = await getOrganization();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/deel/org]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

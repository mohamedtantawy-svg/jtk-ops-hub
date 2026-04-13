// ── GET /api/v1/integrations/deel/people ─────────────────────────────────────
// Proxies to Deel Admin API: list people / search by email
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listPeople, getPersonByEmail, isDeelConfigured } from '../../../../../../src/lib/deel-api';

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
    const email = searchParams.get('email');
    const search = searchParams.get('search');
    const limit = searchParams.get('limit') || '50';
    const offset = searchParams.get('offset') || '0';

    let result;
    if (email) {
      result = await getPersonByEmail(email);
    } else {
      result = await listPeople({ search, limit, offset });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/deel/people]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

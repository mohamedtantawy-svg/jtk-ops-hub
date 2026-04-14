// ── GET /api/v1/integrations/deel/contracts ──────────────────────────────────
// Proxies to Deel Admin API: list contracts
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listContracts, getContract, isDeelConfigured } from '../../../../../../src/lib/deel-api';

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
    const id = searchParams.get('id');

    if (id) {
      const contract = await getContract(id);
      return NextResponse.json(contract);
    }

    const result = await listContracts({
      search: searchParams.get('search'),
      statuses: searchParams.get('statuses'),
      types: searchParams.get('types'),
      limit: searchParams.get('limit') || '50',
      offset: searchParams.get('offset') || '0',
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/deel/contracts]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

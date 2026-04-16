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

    // Clamp pagination to safe bounds
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
    const limit = String(Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200));
    const offset = String(Math.max(0, isNaN(rawOffset) ? 0 : rawOffset));

    const result = await listContracts({
      search: searchParams.get('search'),
      statuses: searchParams.get('statuses'),
      types: searchParams.get('types'),
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/deel/contracts]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

// ── GET /api/v1/integrations/deel/offboarding ───────────────────────────────
// Returns active EOR termination cases from the Deel Admin API.
// Pages through all EOR in_progress contracts, filters for those with
// termination_date set, enriches with country from EOR details.
// Caches server-side for 5 minutes to avoid hammering the Deel API.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listOffboardingCases, isDeelConfigured } from '../../../../../../src/lib/deel-api';

let cache = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
    const bustCache = searchParams.get('bust') === '1';

    // Return cached if fresh
    if (!bustCache && cache.data && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.data);
    }

    const raw = await listOffboardingCases();
    const now = new Date();

    const items = raw.map(c => {
      const endDate = c.terminationDate ? new Date(c.terminationDate) : null;
      const daysUntilEnd = endDate ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)) : null;

      return {
        id: c.contractId,
        name: c.name,
        email: c.email,
        country: c.country || '',
        jobTitle: c.jobTitle || '',
        team: c.team || '',
        hiringType: c.hiringType || 'eor',
        endDate: c.terminationDate || '',
        startDate: c.startDate || '',
        requestedDate: c.createdAt || '',
        updatedAt: c.updatedAt || '',
        daysUntilEnd,
        noticePeriod: c.noticePeriod || 0,
        clientEmail: c.clientEmail || '',
        creatorName: c.creatorName || '',
        creatorEmail: c.creatorEmail || '',
        status: deriveStatus(daysUntilEnd),
        contractUrl: `https://app.deel.com/contracts/${c.contractId}`,
      };
    });

    // Sort: most urgent first (lowest daysUntilEnd)
    items.sort((a, b) => (a.daysUntilEnd ?? 9999) - (b.daysUntilEnd ?? 9999));

    const result = { items, total: items.length };
    cache = { data: result, ts: Date.now() };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/deel/offboarding]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

function deriveStatus(daysUntilEnd) {
  if (daysUntilEnd === null) return { label: 'Unknown', severity: 'info', color: '#9e9e9e' };
  if (daysUntilEnd < 0)  return { label: 'Overdue', severity: 'critical', color: '#d42d35' };
  if (daysUntilEnd <= 14) return { label: 'Imminent', severity: 'critical', color: '#d42d35' };
  if (daysUntilEnd <= 30) return { label: 'Awaiting Action', severity: 'warning', color: '#ed8d00' };
  if (daysUntilEnd <= 90) return { label: 'In Progress', severity: 'active', color: '#1d4ed8' };
  return { label: 'Scheduled', severity: 'info', color: '#616161' };
}

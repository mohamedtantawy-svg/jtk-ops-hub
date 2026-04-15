// ── GET /api/v1/integrations/deel/offboarding ───────────────────────────────
// Returns active EOR termination cases from the Deel Admin API.
// Pages through all EOR in_progress contracts, filters for those with
// termination_date set, enriches with country from EOR details.
// Uses persistent file cache (survives restarts) + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listOffboardingCases, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';

const CACHE_KEY = 'deel_offboarding';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 60 * 60 * 1000;   // serve stale up to 60 minutes (offboarding data is slow-moving)

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

    // Return fresh cache if available
    if (!bustCache) {
      const fresh = cacheGet(CACHE_KEY, CACHE_TTL);
      if (fresh) return NextResponse.json(fresh);
    }

    // Try to fetch fresh data
    let result;
    try {
      result = await buildOffboardingResult();
      cacheSet(CACHE_KEY, result);
    } catch (fetchErr) {
      // If fetch fails, try returning stale cache
      const stale = cacheGet(CACHE_KEY, STALE_TTL);
      if (stale) {
        console.warn('[offboarding] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...stale, _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations/deel/offboarding]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

async function buildOffboardingResult() {
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

  items.sort((a, b) => (a.daysUntilEnd ?? 9999) - (b.daysUntilEnd ?? 9999));
  return { items, total: items.length };
}

function deriveStatus(daysUntilEnd) {
  if (daysUntilEnd === null) return { label: 'Unknown', severity: 'info', color: '#9e9e9e' };
  if (daysUntilEnd < 0)  return { label: 'Overdue', severity: 'critical', color: '#d42d35' };
  if (daysUntilEnd <= 14) return { label: 'Imminent', severity: 'critical', color: '#d42d35' };
  if (daysUntilEnd <= 30) return { label: 'Awaiting Action', severity: 'warning', color: '#ed8d00' };
  if (daysUntilEnd <= 90) return { label: 'In Progress', severity: 'active', color: '#1d4ed8' };
  return { label: 'Scheduled', severity: 'info', color: '#616161' };
}

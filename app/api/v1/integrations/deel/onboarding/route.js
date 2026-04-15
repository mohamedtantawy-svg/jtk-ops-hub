// ── GET /api/v1/integrations/deel/onboarding ────────────────────────────────
// Proxies to Deel Admin API: onboarding actionable queue.
// Uses /admin/eor/employee-manager/list/Onboarding.ActionableQueue
// Uses persistent cache + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listOnboardingPeople, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';

const CACHE_KEY = 'deel_onboarding';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 30 * 60 * 1000;   // serve stale up to 30 minutes

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
    const offset = searchParams.get('offset') || '0';
    const debug = searchParams.get('debug') === '1';

    // Return fresh cache if available (skip in debug mode)
    const cacheKeyFull = `${CACHE_KEY}_${offset}`;
    if (!debug) {
      const fresh = cacheGet(cacheKeyFull, CACHE_TTL);
      if (fresh) return NextResponse.json(fresh);
    }

    let responseData;
    try {
      const result = await listOnboardingPeople({ offset });

      // Debug mode: return raw shape info for diagnosis
      if (debug) {
        return NextResponse.json({
          _debug: true,
          _raw: result._raw,
          _itemCount: result.items.length,
          _sampleItem: result.items[0] || null,
        });
      }

      const items = result.items.map(p => ({
        ...p,
        action: deriveAction(p.hiringStatus),
      }));

      responseData = {
        items,
        total: items.length,
        _apiTotal: result._raw?.totalFromApi,
      };
      cacheSet(cacheKeyFull, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(cacheKeyFull, STALE_TTL);
      if (stale) {
        console.warn('[onboarding] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...stale, _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(responseData);
  } catch (err) {
    console.error('[integrations/deel/onboarding]', err.message);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

/**
 * Derive an action descriptor from the hiring/onboarding status.
 * Handles both snake_case and SCREAMING_CASE admin statuses.
 */
function deriveAction(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('overdue'))                          return { label: 'Overdue', severity: 'critical', description: 'Onboarding overdue — immediate action required' };
  if (s.includes('risk'))                             return { label: 'At Risk', severity: 'warning', description: 'Onboarding at risk — attention needed' };
  if (s.includes('pending') || s.includes('invite'))  return { label: 'Pending Invite', severity: 'info', description: 'Invitation not yet sent' };
  if (s.includes('blocked') || s.includes('stuck'))   return { label: 'Blocked', severity: 'critical', description: 'Onboarding blocked' };
  if (s.includes('awaiting'))                         return { label: 'Awaiting Action', severity: 'warning', description: 'Awaiting action' };
  return { label: 'In Progress', severity: 'active', description: 'Onboarding steps in progress' };
}

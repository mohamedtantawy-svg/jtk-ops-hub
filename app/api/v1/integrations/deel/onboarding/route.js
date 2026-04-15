// ── GET /api/v1/integrations/deel/onboarding ────────────────────────────────
// Proxies to Deel Admin API: list people in onboarding statuses.
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
    const limit = searchParams.get('limit') || '200';
    const offset = searchParams.get('offset') || '0';

    // Return fresh cache if available
    const cacheKeyFull = `${CACHE_KEY}_${limit}_${offset}`;
    const fresh = cacheGet(cacheKeyFull, CACHE_TTL);
    if (fresh) return NextResponse.json(fresh);

    let responseData;
    try {
      const result = await listOnboardingPeople({ limit, offset });

      const people = (result?.data || []).filter(p =>
        ['onboarding', 'onboarding_at_risk', 'onboarding_overdue', 'pending_invite'].includes(p.hiring_status)
      );

      const items = people.map(p => {
        const emp = p.employments?.[0] || {};
        return {
          id: p.id,
          name: p.full_name,
          email: p.email,
          country: emp.country || p.country || '',
          countryName: p.country_name || '',
          hiringStatus: p.hiring_status,
          startDate: emp.start_date || p.start_date || '',
          jobTitle: emp.job_title || '',
          hiringType: emp.hiring_type || '',
          contractId: emp.id || '',
          contractStatus: emp.contract_status || '',
          team: emp.team?.name || '',
          action: deriveAction(p.hiring_status, emp),
        };
      });

      responseData = { items, total: items.length, page: result?.page || {} };
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

function deriveAction(status, emp) {
  switch (status) {
    case 'onboarding_overdue':
      return { label: 'Overdue', severity: 'critical', description: 'Onboarding overdue - immediate action required' };
    case 'onboarding_at_risk':
      return { label: 'At Risk', severity: 'warning', description: 'Onboarding at risk - attention needed' };
    case 'pending_invite':
      return { label: 'Pending Invite', severity: 'info', description: 'Invitation not yet sent' };
    case 'onboarding':
    default:
      return { label: 'In Progress', severity: 'active', description: 'Onboarding steps in progress' };
  }
}

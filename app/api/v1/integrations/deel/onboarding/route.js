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

    // Return fresh cache if available
    const cacheKeyFull = `${CACHE_KEY}_${offset}`;
    const fresh = cacheGet(cacheKeyFull, CACHE_TTL);
    if (fresh) return NextResponse.json(fresh);

    let responseData;
    try {
      const result = await listOnboardingPeople({ offset });

      // The admin API may return data in various shapes — handle flexibly
      const rawItems = result?.data || result?.rows || result?.items || (Array.isArray(result) ? result : []);

      const items = rawItems.map(p => {
        // Admin API fields may differ from REST v2 — map flexibly
        const emp = p.employments?.[0] || p.employment || {};
        return {
          id: p.id || p.contract_id || p.employee_id || '',
          name: p.full_name || p.employee_name || p.worker_name || p.name || '',
          email: p.email || p.worker_email || p.employee_email || '',
          country: emp.country || p.country || p.employment_country || '',
          countryName: p.country_name || p.employment_country_name || '',
          hiringStatus: p.hiring_status || p.status || p.onboarding_status || '',
          startDate: emp.start_date || p.start_date || p.effective_date || '',
          jobTitle: emp.job_title || p.job_title || p.position || '',
          hiringType: emp.hiring_type || p.hiring_type || p.contract_type || '',
          contractId: emp.id || p.contract_id || '',
          contractStatus: emp.contract_status || p.contract_status || '',
          team: emp.team?.name || p.team || p.team_name || '',
          action: deriveAction(p.hiring_status || p.status || p.onboarding_status || '', emp),
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
  const s = (status || '').toLowerCase();
  if (s.includes('overdue')) return { label: 'Overdue', severity: 'critical', description: 'Onboarding overdue - immediate action required' };
  if (s.includes('risk'))    return { label: 'At Risk', severity: 'warning', description: 'Onboarding at risk - attention needed' };
  if (s.includes('pending') || s.includes('invite')) return { label: 'Pending Invite', severity: 'info', description: 'Invitation not yet sent' };
  return { label: 'In Progress', severity: 'active', description: 'Onboarding steps in progress' };
}

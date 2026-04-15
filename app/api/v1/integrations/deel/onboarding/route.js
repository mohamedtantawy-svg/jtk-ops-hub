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

    // Debug mode: return raw response shape to diagnose field mapping
    const debug = searchParams.get('debug') === '1';

    let responseData;
    try {
      const result = await listOnboardingPeople({ offset });

      // If debug mode, return the raw response shape for investigation
      if (debug) {
        const topKeys = result ? Object.keys(result) : [];
        const sample = {};
        for (const key of topKeys) {
          const val = result[key];
          if (Array.isArray(val)) {
            sample[key] = { _type: 'array', _length: val.length, _firstItem: val[0] || null };
          } else if (typeof val === 'object' && val !== null) {
            sample[key] = { _type: 'object', _keys: Object.keys(val) };
          } else {
            sample[key] = val;
          }
        }
        return NextResponse.json({ _debug: true, _topKeys: topKeys, _shape: sample, _raw_first_key_array: findFirstArray(result) });
      }

      // The admin API returns data in various shapes — try known keys
      const rawItems = result?.data || result?.rows || result?.items
        || result?.employees || result?.people || result?.records
        || (Array.isArray(result) ? result : []);

      const items = rawItems.map(p => {
        // Admin API fields may differ from REST v2 — map flexibly
        const emp = p.employments?.[0] || p.employment || {};
        return {
          id: p.id || p.contract_id || p.employee_id || p.contractId || '',
          name: p.full_name || p.employee_name || p.worker_name || p.name || '',
          email: p.email || p.worker_email || p.employee_email || '',
          country: p.employmentCountry || emp.country || p.country || p.employment_country || '',
          countryName: p.country_name || p.employment_country_name || p.countryName || '',
          hiringStatus: p.hiring_status || p.status || p.onboarding_status || p.hiringStatus || '',
          startDate: p.startDate || emp.start_date || p.start_date || p.effective_date || '',
          jobTitle: p.jobTitle || emp.job_title || p.job_title || p.position || '',
          hiringType: p.hiringType || emp.hiring_type || p.hiring_type || p.contract_type || '',
          contractId: p.contractId || p.contractOid || emp.id || p.contract_id || '',
          contractStatus: p.contractStatus || emp.contract_status || p.contract_status || '',
          team: p.team || emp.team?.name || p.team_name || '',
          organizationName: p.organizationName || '',
          action: deriveAction(p.hiring_status || p.status || p.onboarding_status || p.hiringStatus || '', emp),
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

/** Find the first array value in an object, return its key + first element */
function findFirstArray(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val) && val.length > 0) {
      return { _key: key, _length: val.length, _firstItemKeys: Object.keys(val[0] || {}), _firstItem: val[0] };
    }
  }
  return null;
}

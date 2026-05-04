// ── GET /api/v1/integrations/deel/incentive-plans ──────────────────────────
// Proxies to Deel Admin API: incentive-plan rows pending IP preparation.
// Cursor-paginated. Same shape as the redlines / amendments routes —
// scope-applied (country-OR-assignee), persistent cache, stale-while-
// revalidate fallback.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listIncentivePlans, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { scopeIncentivePlans } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { buildWithTimeout } from '../../../../../../src/lib/scan-timeout';
import { getReassignmentMap, applyReassignments } from '../../../../../../src/lib/queue-reassignments';

const DEFAULT_STATUSES = ['PENDING_IP_PREPARATION'];
const CACHE_KEY = 'deel_incentive_plans_v1';
const CACHE_TTL = 5 * 60 * 1000;     // 5 minutes
const STALE_TTL = 30 * 60 * 1000;    // 30 minutes
const SCAN_TIMEOUT_MS = 45_000;

function scoped(data, user, overrideMap) {
  if (!data?.items) return data;
  const overlaid = applyReassignments(data.items, overrideMap);
  const items = scopeIncentivePlans(overlaid, user);
  return { ...data, items, total: items.length };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();
  const overrideMap = await getReassignmentMap('incentive_plans');

  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const statuses = statusParam
      ? statusParam.split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_STATUSES;
    const bustCache = searchParams.get('bust') === '1';

    const cacheKeyFull = `${CACHE_KEY}_${statuses.join('|').replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    if (!bustCache) {
      const fresh = cacheGet(cacheKeyFull, CACHE_TTL);
      if (fresh) return NextResponse.json(scoped(fresh, user, overrideMap));
    }

    let responseData;
    try {
      const r = await buildWithTimeout(cacheKeyFull, async () => {
        const result = await listIncentivePlans({ status: statuses });
        const items = result.items.map(rr => ({
          ...rr,
          displayStatus: deriveIncentivePlanStatus(rr),
        }));
        return { items, total: result.total };
      }, { timeoutMs: SCAN_TIMEOUT_MS, staleTtl: STALE_TTL });
      if (r.result == null) {
        return NextResponse.json(
          { error: 'Incentive plans scan timed out — please retry', _timeout: true },
          { status: 504 },
        );
      }
      if (r.timedOut) {
        console.warn('[incentive-plans] Live build exceeded %dms — serving stale cache', SCAN_TIMEOUT_MS);
        return NextResponse.json({ ...scoped(r.result, user, overrideMap), _stale: true, _stale_reason: 'timeout' });
      }
      responseData = r.result;
    } catch (fetchErr) {
      const stale = cacheGet(cacheKeyFull, STALE_TTL);
      if (stale) {
        console.warn('[incentive-plans] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user, overrideMap), _stale: true, _stale_reason: 'error' });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user, overrideMap));
  } catch (err) {
    console.error('[integrations/deel/incentive-plans]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

// PENDING_IP_PREPARATION is the only spec'd status today — render as
// "Pending IP Preparation" with the warning palette so it draws the eye
// like the redline review bucket. Future statuses fall through to a
// generic "In Progress" tag.
function deriveIncentivePlanStatus(row) {
  const s = (row.status || '').toUpperCase();
  if (s === 'PENDING_IP_PREPARATION') {
    return { label: 'Pending IP Preparation', severity: 'warning', color: '#ed8d00' };
  }
  if (s.includes('PAUSED')) {
    return { label: 'Paused', severity: 'warning', color: '#6b6560' };
  }
  return { label: row.status || 'Incentive Plan', severity: 'active', color: '#1d4ed8' };
}

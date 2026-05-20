import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listPausedOnboarding, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { getCurrentDeptSlugAndId } from '../../../../../../src/lib/dept-scope';
import { isDeelSourceVisible } from '../../../../../../src/lib/dept-integrations';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { scopePausedOnboarding } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { getReassignmentMap, applyReassignments } from '../../../../../../src/lib/queue-reassignments';

const CACHE_KEY = 'deel_onboarding_paused';
const CACHE_TTL = 5 * 60 * 1000;
const STALE_TTL = 30 * 60 * 1000;

// Paused-onboarding shares the 'onboarding' override namespace with the
// active queue so a user reassigning a row from the unified Onboarding tab
// doesn't have to think about which sub-stream a task lives in.
function scoped(data, user, overrideMap) {
  if (!data?.items) return data;
  const overlaid = applyReassignments(data.items, overrideMap);
  const items = scopePausedOnboarding(overlaid, user);
  return { ...data, items, total: items.length };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Phase 13a: paused-onboarding tracks the parent 'onboarding' visibility.
  {
    const deptInfo = await getCurrentDeptSlugAndId(user, req);
    if (!isDeelSourceVisible(deptInfo?.deptSlug, 'onboarding')) {
      return NextResponse.json({ items: [], total: 0, disabled: true, reason: 'source-disabled-for-dept' });
    }
  }
  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();
  const overrideMap = await getReassignmentMap('onboarding');

  try {
    const fresh = cacheGet(CACHE_KEY, CACHE_TTL);
    if (fresh) return NextResponse.json(scoped(fresh, user, overrideMap));

    let responseData;
    try {
      const result = await listPausedOnboarding();
      responseData = { items: result.items, total: result.total };
      cacheSet(CACHE_KEY, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(CACHE_KEY, STALE_TTL);
      if (stale) {
        console.warn('[onboarding-paused] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user, overrideMap), _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user, overrideMap));
  } catch (err) {
    console.error('[integrations/deel/onboarding-paused]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

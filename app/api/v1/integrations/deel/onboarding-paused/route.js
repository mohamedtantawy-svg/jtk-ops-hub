import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listPausedOnboarding, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { scopePausedOnboarding } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';

const CACHE_KEY = 'deel_onboarding_paused';
const CACHE_TTL = 5 * 60 * 1000;
const STALE_TTL = 30 * 60 * 1000;

function scoped(data, user) {
  if (!data?.items) return data;
  const items = scopePausedOnboarding(data.items, user);
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

  try {
    const fresh = cacheGet(CACHE_KEY, CACHE_TTL);
    if (fresh) return NextResponse.json(scoped(fresh, user));

    let responseData;
    try {
      const result = await listPausedOnboarding();
      responseData = { items: result.items, total: result.total };
      cacheSet(CACHE_KEY, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(CACHE_KEY, STALE_TTL);
      if (stale) {
        console.warn('[onboarding-paused] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user), _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user));
  } catch (err) {
    console.error('[integrations/deel/onboarding-paused]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

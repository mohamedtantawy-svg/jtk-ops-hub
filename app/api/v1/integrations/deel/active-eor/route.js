// ── GET /api/v1/integrations/deel/active-eor ────────────────────────────────
// Proxies to Deel Admin API: the post-onboarding "Active EOR" awaiting-review
// queue. Fans out across five Active.<Section>.AwaitingReview statuses via the
// same /admin/eor/employee-manager/{list,countries/list}/<status> family
// onboarding uses (listActiveEorPeople). Each row carries the sub-status it was
// found under so the FE renders a per-row Type column. HRX-only source.
// Uses persistent cache + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listActiveEorPeople, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { getCurrentDeptSlugAndId } from '../../../../../../src/lib/dept-scope';
import { isDeelSourceVisible } from '../../../../../../src/lib/dept-integrations';
import { cacheGet } from '../../../../../../src/lib/server-cache';
import { scopeActiveEor } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { buildWithTimeout } from '../../../../../../src/lib/scan-timeout';
import { getReassignmentMap, applyReassignments } from '../../../../../../src/lib/queue-reassignments';

const CACHE_KEY = 'deel_active_eor';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 30 * 60 * 1000;   // serve stale up to 30 minutes
// Active EOR fans 5 statuses × per-country (BATCH_SIZE=3) sequentially, so it
// has a deep fan-out like onboarding. Match onboarding's 60s ceiling so
// upstream Retry-After slop doesn't trip the timeout. fetchDeelActiveEor sets
// the FE AbortController to the same 60s (the heavy-Deel-scan convention used
// by offboarding/workbench/immigration), so the FE captures the server's
// stale/504 response cleanly instead of aborting first.
const SCAN_TIMEOUT_MS = 60_000;

// Scope the cached payload for this user (country-OR-assignee for active_eor).
// Cache stores the full payload; each request filters on the way out.
// `overrideMap` overlays in-app reassignments on the row's assigneeEmail
// before scoping — see src/lib/queue-reassignments.js.
function scoped(data, user, overrideMap) {
  if (!data?.items) return data;
  const overlaid = applyReassignments(data.items, overrideMap);
  const items = scopeActiveEor(overlaid, user);
  return { ...data, items, total: items.length };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // HRX-only source: hide for any dept whose profile excludes it. Fail-closed
  // for unknown depts. NOTE: the deelSources keys are camelCase, so the gate
  // arg MUST be 'activeEor' (not the snake_case row/queue id 'active_eor').
  {
    const deptInfo = await getCurrentDeptSlugAndId(user, req);
    if (!isDeelSourceVisible(deptInfo?.deptSlug, 'activeEor')) {
      return NextResponse.json({ items: [], total: 0, disabled: true, reason: 'source-disabled-for-dept' });
    }
  }
  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();
  const overrideMap = await getReassignmentMap('active_eor');

  try {
    const fresh = cacheGet(CACHE_KEY, CACHE_TTL);
    if (fresh) return NextResponse.json(scoped(fresh, user, overrideMap));

    let responseData;
    try {
      const r = await buildWithTimeout(CACHE_KEY, async () => {
        const result = await listActiveEorPeople();
        return { items: result.items, total: result.total };
      }, { timeoutMs: SCAN_TIMEOUT_MS, staleTtl: STALE_TTL });
      if (r.result == null) {
        return NextResponse.json(
          { error: 'Active EOR scan timed out — please retry', _timeout: true },
          { status: 504 },
        );
      }
      if (r.timedOut) {
        console.warn('[active-eor] Live build exceeded %dms — serving stale cache', SCAN_TIMEOUT_MS);
        return NextResponse.json({ ...scoped(r.result, user, overrideMap), _stale: true, _stale_reason: 'timeout' });
      }
      responseData = r.result;
    } catch (fetchErr) {
      const stale = cacheGet(CACHE_KEY, STALE_TTL);
      if (stale) {
        console.warn('[active-eor] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user, overrideMap), _stale: true, _stale_reason: 'error' });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user, overrideMap));
  } catch (err) {
    console.error('[integrations/deel/active-eor]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

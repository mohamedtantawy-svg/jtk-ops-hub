// ── GET /api/v1/integrations/deel/immigration-tasks ────────────────────────
// GIX-only Deel source. Backs the "Immigration Tasks" queue surface on
// the Global Immigration dept. Proxies to /admin/mobility/actions with
// `caseStatus[]=OPEN` + `status[]=ONGOING` (i.e. "Active only" per
// Mohamed's spec).
//
// Mirrors the Workbench route shape (Phase 13b dispatch + dept-namespaced
// cache + dept-isolated visibility gate). HRX deelSources have
// `immigrationTasks: false`, so HRX users hitting this endpoint get a
// fail-closed `disabled` payload — they never see the immigration
// backlog.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listImmigrationActions, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { getCurrentDeptSlugAndId } from '../../../../../../src/lib/dept-scope';
import { isDeelSourceVisible, resolveWorkbenchConfig, SLUGS } from '../../../../../../src/lib/dept-integrations';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { filterByAssignee } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { buildWithTimeout } from '../../../../../../src/lib/scan-timeout';
import { normalizeImmigrationTasks } from '../../../../../../src/utils/normalizeSourceRows';

const CACHE_KEY = 'deel_immigration_tasks';
const CACHE_TTL = 3 * 60 * 1000;
const STALE_TTL = 30 * 60 * 1000;
const SCAN_TIMEOUT_MS = 45_000;

function scoped(data, user) {
  if (!data?.items) return data;
  // Reuse the assignee-based scoping helper that every other Deel queue
  // uses (same role matrix — agent sees own, TL sees direct reports,
  // RM sees subtree, admin sees all). Rows carry `assigneeEmail` after
  // normalisation so the filter operates uniformly.
  const items = filterByAssignee(data.items, user);
  return { ...data, items, total: items.length };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Dept visibility gate. HRX returns `disabled: true` early so the FE
  // can hide the tab if it ever leaks into the wrong scope.
  const deptInfo = await getCurrentDeptSlugAndId(user, req);
  if (!isDeelSourceVisible(deptInfo?.deptSlug, 'immigrationTasks')) {
    return NextResponse.json({ items: [], total: 0, disabled: true, reason: 'source-disabled-for-dept' });
  }

  // HRX never reaches this route in practice (gated above) — but if it
  // did, fail-closed rather than letting the workbench token through.
  const isHrx = !deptInfo || deptInfo.deptSlug === SLUGS.HR_EXPERIENCE;
  if (isHrx) {
    return NextResponse.json({ items: [], total: 0, disabled: true, reason: 'hrx-not-supported' });
  }

  // Reuse the workbench config resolver — Immigration Tasks uses the
  // SAME `DEEL_ADMIN_GIX` token as Workbench (Mohamed's spec). The
  // resolver only returns the token + tokenSource for us; we ignore
  // teamIds/teamFilter since /admin/mobility/actions doesn't accept
  // teamIds.
  const workbenchCfg = resolveWorkbenchConfig(deptInfo.deptSlug);
  if (!workbenchCfg) {
    return NextResponse.json({
      items: [], total: 0, disabled: true,
      reason: 'dept-immigration-tasks-token-not-configured',
    });
  }

  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  // Roster hydration drives the assignee-visibility set in
  // filterByAssignee. Same TTL-gated helper every other Deel route uses.
  await ensureRosterHydrated();

  try {
    const { searchParams } = new URL(req.url);
    const bustCache = searchParams.get('bust') === '1' || searchParams.has('_t');
    const take = parseInt(searchParams.get('take') || '100', 10);

    // Dept-namespaced cache key so HRX's snapshot (none, in practice)
    // can never leak to a GIX caller and vice versa.
    const cacheKey = `${CACHE_KEY}_${deptInfo.deptSlug}`;

    if (!bustCache) {
      const fresh = cacheGet(cacheKey, CACHE_TTL);
      if (fresh) return NextResponse.json(scoped(fresh, user));
    }

    let responseData;
    try {
      const r = await buildWithTimeout(
        cacheKey,
        async () => {
          const result = await listImmigrationActions({
            take,
            adminTokenOverride: workbenchCfg.token,
          });
          // Normalise to the standard queue row shape so SourceTable can
          // render the rows without per-source rendering forks.
          const items = normalizeImmigrationTasks(result.items || []);
          return { items, total: items.length };
        },
        { timeoutMs: SCAN_TIMEOUT_MS, staleTtl: STALE_TTL },
      );
      if (r.result == null) {
        // Cold cache + timeout — return empty + warming hint, same as
        // workbench's pattern.
        return NextResponse.json({
          items: [],
          total: 0,
          _warming: true,
          _warming_message: 'Immigration tasks data is warming up — auto-refreshes when ready.',
        });
      }
      if (r.timedOut) {
        console.warn('[immigration-tasks] Live build exceeded %dms — serving stale cache', SCAN_TIMEOUT_MS);
        return NextResponse.json({ ...scoped(r.result, user), _stale: true, _stale_reason: 'timeout' });
      }
      responseData = r.result;
      cacheSet(cacheKey, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(cacheKey, STALE_TTL);
      if (stale) {
        console.warn('[immigration-tasks] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user), _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user));
  } catch (err) {
    console.error('[integrations/deel/immigration-tasks]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

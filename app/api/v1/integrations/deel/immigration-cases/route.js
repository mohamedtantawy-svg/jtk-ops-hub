// ── GET /api/v1/integrations/deel/immigration-cases ────────────────────────
// GIX-only Deel source. Backs the "Immigration Cases" queue surface on the
// Global Immigration dept. Proxies to /admin/mobility/cases with
// `statuses[]=OPEN` + `statuses[]=ON_HOLD` (all open + on-hold cases per
// Mohamed/Beata's 2026-06-03 spec) and walks EVERY page so no case is missed.
//
// Mirrors the Immigration Tasks route shape (dept-namespaced cache +
// dept-isolated visibility gate + warming/stale fallback). HRX deelSources
// has `immigrationCases: false`, so HRX users hitting this endpoint get a
// fail-closed `disabled` payload — they never see the immigration case backlog.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listImmigrationCases, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { getCurrentDeptSlugAndId } from '../../../../../../src/lib/dept-scope';
import { isDeelSourceVisible, resolveWorkbenchConfig, SLUGS } from '../../../../../../src/lib/dept-integrations';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { filterByAssignee } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { buildWithTimeout } from '../../../../../../src/lib/scan-timeout';
import { normalizeImmigrationCases } from '../../../../../../src/utils/normalizeSourceRows';

const CACHE_KEY = 'deel_immigration_cases';
const CACHE_TTL = 3 * 60 * 1000;
const STALE_TTL = 30 * 60 * 1000;
const SCAN_TIMEOUT_MS = 45_000;

function scoped(data, user) {
  if (!data?.items) return data;
  // Reuse the assignee-based scoping helper that every other Deel queue uses
  // (agent sees own, TL sees direct reports, RM sees subtree, admin sees all).
  // Rows carry `assigneeEmail` (the case's active agent) after normalisation.
  const items = filterByAssignee(data.items, user);
  return { ...data, items, total: items.length };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Dept visibility gate. HRX returns `disabled: true` early so the FE can
  // hide the tab if it ever leaks into the wrong scope.
  const deptInfo = await getCurrentDeptSlugAndId(user, req);
  if (!isDeelSourceVisible(deptInfo?.deptSlug, 'immigrationCases')) {
    return NextResponse.json({ items: [], total: 0, disabled: true, reason: 'source-disabled-for-dept' });
  }

  // HRX never reaches this route in practice (gated above) — but if it did,
  // fail-closed rather than letting the HRX workbench token through.
  const isHrx = !deptInfo || deptInfo.deptSlug === SLUGS.HR_EXPERIENCE;
  if (isHrx) {
    return NextResponse.json({ items: [], total: 0, disabled: true, reason: 'hrx-not-supported' });
  }

  // Reuse the workbench config resolver — Immigration Cases uses the SAME
  // `DEEL_ADMIN_GIX` token as Workbench / Immigration Tasks (Mohamed's spec).
  // We only need the token; /admin/mobility/cases doesn't accept teamIds.
  const workbenchCfg = resolveWorkbenchConfig(deptInfo.deptSlug);
  if (!workbenchCfg) {
    return NextResponse.json({
      items: [], total: 0, disabled: true,
      reason: 'dept-immigration-cases-token-not-configured',
    });
  }

  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();

  try {
    const { searchParams } = new URL(req.url);
    const bustCache = searchParams.get('bust') === '1' || searchParams.has('_t');
    // /admin/mobility/cases is cursor-paginated; take=100 is honoured. (The
    // earlier take=20 made the walk too many slow pages → build timeout →
    // "0 Waiting".) The fetcher walks via cursor up to its MAX_PAGES ceiling.
    const take = parseInt(searchParams.get('take') || '100', 10);

    // Dept-namespaced cache key so HRX's snapshot (none, in practice) can
    // never leak to a GIX caller and vice versa.
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
          const result = await listImmigrationCases({
            take,
            adminTokenOverride: workbenchCfg.token,
          });
          // Normalise to the bespoke Immigration Cases row shape the FE
          // ImmigrationCasesTable renders.
          const items = normalizeImmigrationCases(result.items || []);
          // Telemetry (skill §3.6): the raw status distribution + page count
          // is the only post-deploy signal that the full walk pulled
          // everything we expected.
          console.info(
            '[immigration-cases] upstream scan: cases=%d scanned=%d pages=%d total=%s truncated=%s statuses=%s',
            result.items?.length ?? 0,
            result.upstreamScanned ?? 0,
            result.upstreamPages,
            result.upstreamTotal == null ? 'n/a' : String(result.upstreamTotal),
            result.truncated === true,
            JSON.stringify(result.upstreamStatusCounts || {}),
          );
          return {
            items,
            total: items.length,
            upstreamStatusCounts: result.upstreamStatusCounts || {},
            upstreamTotal: result.upstreamTotal ?? null,
            upstreamPages: result.upstreamPages ?? 0,
            upstreamScanned: result.upstreamScanned ?? items.length,
          };
        },
        { timeoutMs: SCAN_TIMEOUT_MS, staleTtl: STALE_TTL },
      );
      if (r.result == null) {
        return NextResponse.json({
          items: [],
          total: 0,
          _warming: true,
          _warming_message: 'Immigration cases data is warming up — auto-refreshes when ready.',
        });
      }
      if (r.timedOut) {
        console.warn('[immigration-cases] Live build exceeded %dms — serving stale cache', SCAN_TIMEOUT_MS);
        return NextResponse.json({ ...scoped(r.result, user), _stale: true, _stale_reason: 'timeout' });
      }
      responseData = r.result;
      cacheSet(cacheKey, responseData);
    } catch (fetchErr) {
      const stale = cacheGet(cacheKey, STALE_TTL);
      if (stale) {
        console.warn('[immigration-cases] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user), _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(responseData, user));
  } catch (err) {
    console.error('[integrations/deel/immigration-cases]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

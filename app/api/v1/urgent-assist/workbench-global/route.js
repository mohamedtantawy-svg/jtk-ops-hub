// ── GET /api/v1/urgent-assist/workbench-global ─────────────────────────────
// Returns ALL Deel workbench tasks whose taskType matches the Urgent Assist
// task-type allowlist, UNSCOPED by caller role.
//
// Why this exists: the canonical /api/v1/integrations/deel/workbench route
// applies `scopeWorkbenchTasks(items, user)` so non-admin callers only see
// their visibility chain. That's correct for the queue/workbench surfaces
// (everyone sees their own work) but WRONG for the "All: Manager on Call
// View" scope on the Urgent Assist tab — per spec, that scope is org-wide
// visible: anyone (agent, TL, RM, admin) should see every active urgent-
// assist row across the org.
//
// Without this endpoint, RM/TL/Agent users on the All scope only saw their
// scoped subset — Duygu Cakalli (RM, EMEA) reported seeing 0 in the All
// view 2026-05-08 because no urgent-assist work was assigned within her
// regional subtree, while admin saw 19. Same scoped IntegrationsContext
// data drove both surfaces; one needed it scoped, the other didn't.
//
// Auth: any authenticated user (the spec is "visible to everyone").
// Cache: piggybacks on the workbench route's persistent cache so we don't
// trigger a second admin-API scan; just read the same cached payload and
// filter to UA task types.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { listWorkbenchTasks, isDeelConfigured } from '../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../src/lib/server-cache';
import { isUrgentAssistTaskType } from '../../../../../src/lib/urgent-assist-task-types';
import { buildWithTimeout } from '../../../../../src/lib/scan-timeout';

// Reuse the same cache key as the canonical workbench route so we read the
// same upstream payload (the only difference is the post-fetch filter and
// the absence of role scoping). We do NOT write to this key — let the
// canonical route own writes; we just read whatever is fresh / stale and
// cold-build only when the canonical hasn't run yet.
const WORKBENCH_CACHE_KEY = 'deel_workbench';
const FRESH_TTL = 3 * 60 * 1000;
const STALE_TTL = 30 * 60 * 1000;
const SCAN_TIMEOUT_MS = 30_000;

function filterUrgentAssist(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(t => isUrgentAssistTaskType(t?.taskType) || isUrgentAssistTaskType(t?.sourceType));
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isDeelConfigured()) {
    return NextResponse.json({ items: [], total: 0, _reason: 'deel_not_configured' });
  }

  // Try fresh cache first — populated by the canonical workbench route.
  const fresh = cacheGet(WORKBENCH_CACHE_KEY, FRESH_TTL);
  if (fresh) {
    const items = filterUrgentAssist(fresh.items);
    return NextResponse.json({ items, total: items.length });
  }

  // Cache cold — build it ourselves (with the same timeout + stale fallback
  // semantics as the canonical route, so we don't hold the request open
  // past 30 s on a slow upstream).
  try {
    const r = await buildWithTimeout(
      WORKBENCH_CACHE_KEY,
      async () => {
        const result = await listWorkbenchTasks({ limit: 50 });
        return { items: result.items, total: result.total };
      },
      { timeoutMs: SCAN_TIMEOUT_MS, staleTtl: STALE_TTL },
    );
    if (r.result == null) {
      // Cold + timed out — return empty + warming hint, FE can show a
      // gentle "warming up" state instead of spinning the user.
      return NextResponse.json({ items: [], total: 0, _warming: true });
    }
    if (!r.cached) cacheSet(WORKBENCH_CACHE_KEY, r.result);
    const items = filterUrgentAssist(r.result.items);
    return NextResponse.json({ items, total: items.length, ...(r.timedOut ? { _stale: true } : {}) });
  } catch (err) {
    console.warn('[urgent-assist/workbench-global] cold build failed:', err?.message);
    return NextResponse.json({ items: [], total: 0, _error: 'fetch_failed' });
  }
}

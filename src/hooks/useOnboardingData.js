// ── useOnboardingData hook ──────────────────────────────────────────────────
// Fetches onboarding actionable queue from the Deel Admin API.
// Groups by country. Caches in IndexedDB (per-user).
// Stale-while-revalidate: always shows previous data until fresh data arrives.
// De-dupes concurrent refresh() calls and adopts cross-tab broadcasts.
// Auto-refreshes every CACHE_TTL while the tab is visible so long-lived tabs
// don't show a stale "X mins ago" banner.
// Cache key is user-scoped so different signed-in users on the same browser
// never inherit each other's server-scoped payload.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelOnboarding } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';
import { idbGetWithMigration, idbSet } from '../lib/idb-cache';
import { useCurrentDeptId } from '../lib/current-dept-storage';

const SOURCE_ID = 'onboarding';
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY_BASE = 'ops_hub_onboarding_cache';
// Phase 11+ instant-switch (2026-05-21): cache key is keyed by BOTH user
// AND dept so switching depts via the TopNav chip swaps cache namespaces
// without losing the previous dept's payload. Switching back paints from
// the persisted slot — no spinner, no fetch wait. The 'no-dept' fallback
// applies for users without a resolved dept (unassigned / pre-backfill).
const cacheKeyFor = (userEmail, deptId) => {
  const u = userEmail ? `:${String(userEmail).toLowerCase()}` : '';
  const d = deptId ? `:${deptId}` : ':no-dept';
  return `${CACHE_KEY_BASE}${u}${d}`;
};

export function useOnboardingData(enabled = true, userEmail = null) {
  const currentDeptId = useCurrentDeptId();
  // IDB cache is async so initial state is empty; the hydration effect
  // below fills it ~10–50 ms after mount. Was localStorage (5–10 MB cap);
  // moved to IDB after the cap caused spurious "Offline cache is full"
  // banners under a heavy localStorage workload.
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(null);
  // Set to true the moment the first live fetch lands. Used by the IDB
  // hydration effect — if the network beat IDB to it, the cached payload
  // is stale and must NOT overwrite the fresh data.
  const liveReceivedRef = useRef(false);
  // Mirror items via ref so refresh() can read the current count without
  // listing items.length in its deps. Without this, every successful sync
  // changes items.length → refresh's identity → the
  // `useEffect(() => refresh(), [refresh])` re-fires (short-circuited by
  // the TTL guard, but still pure churn). The ref also keeps the
  // post-fetch "fetched empty with cached rows present" guard honest
  // across overlapping in-flight refreshes — closure-captured items.length
  // would be stale by the time the network resolved.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return null;
    if (!force && Date.now() - lastFetchRef.current < CACHE_TTL) return null;
    if (!force && inFlightRef.current) return inFlightRef.current;

    setIsRefreshing(true);
    setLoading(prev => itemsRef.current.length === 0 ? true : prev);
    setError(null);

    const run = (async () => {
      try {
        const res = await fetchDeelOnboarding();
        const fetched = res?.items || [];
        const now = Date.now();
        // User-triggered refresh (force=true) MUST overwrite the local
        // items even when the server legitimately returns an empty result.
        // Without this, reassigning the last row in your queue, hiding
        // it, or any other action that drops the row out of your scope
        // leaves the stale row painted forever — the guard was only
        // intended to defend against transient empty responses on
        // background polls. Jessica Fowler 2026-05-15 "Reassign is not
        // working" bug repro: 1-row queue, reassign, modal closes, row
        // stays — server response is correctly empty but the FE
        // suppresses the update.
        if (force || fetched.length > 0 || itemsRef.current.length === 0) {
          setItems(fetched);
          // Fire-and-forget IDB write — doesn't block the data path.
          idbSet(cacheKeyFor(userEmail, currentDeptId), { items: fetched, ts: now }).catch(() => {});
          broadcastSync(SOURCE_ID, fetched, null, userEmail, currentDeptId);
        }
        lastFetchRef.current = now;
        liveReceivedRef.current = true;
        setLastSyncAt(now);
        return fetched;
      } catch (err) {
        console.warn('[useOnboardingData] Failed:', err.message);
        setError(err.message);
        return null;
      } finally {
        setLoading(false);
        setIsRefreshing(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [enabled, userEmail, currentDeptId]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── IDB cache hydration ───────────────────────────────────────────────────
  // Async-loads the cached payload after mount and merges into state if the
  // live fetch hasn't arrived yet. Includes legacy-localStorage migration
  // (one-shot copy from old key, then cleanup). Re-runs when currentDeptId
  // changes so a dept switch swaps to the target dept's persisted cache.
  useEffect(() => {
    let cancelled = false;
    // Clear in-flight ref so the new dept's refresh isn't blocked by the
    // old dept's pending fetch.
    inFlightRef.current = null;
    // Reset live-received guard so the new dept's cache hydrates even if
    // the previous dept already received a live response.
    liveReceivedRef.current = false;
    (async () => {
      const cached = await idbGetWithMigration(cacheKeyFor(userEmail, currentDeptId));
      if (cancelled) return;
      if (liveReceivedRef.current) return;        // sync beat us — don't overwrite
      if (!cached?.items?.length) {
        // No cache for this dept yet — clear stale items from the previous
        // dept so we don't paint cross-dept data while the new fetch lands.
        setItems([]);
        setLastSyncAt(null);
        lastFetchRef.current = 0;
        return;
      }
      setItems(cached.items);
      lastFetchRef.current = cached.ts || 0;
      setLastSyncAt(cached.ts || null);
    })();
    return () => { cancelled = true; };
  }, [userEmail, currentDeptId]);

  // ── Auto-refresh while visible ─────────────────────────────────────────────
  // Previously the hook only fetched on mount, which meant a tab left open for
  // 10+ minutes displayed a "Synced 10+ mins ago · stale" warning. Refresh on
  // the same cadence as CACHE_TTL, pause while hidden, and re-sync on visibility
  // return to keep the badge green without hammering the API.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refresh();
    };
    const id = setInterval(tick, CACHE_TTL);
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) refresh();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, refresh]);

  // Adopt cross-tab broadcasts for this source — reject broadcasts from a
  // different signed-in user OR a different dept so we never pick up
  // someone else's scoped payload.
  useEffect(() => {
    const ch = getQueueChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg || msg.source !== SOURCE_ID) return;
      const myKey = (userEmail || '').toLowerCase();
      const theirKey = (msg.userKey || '').toLowerCase();
      // Tighter than the previous `myKey && theirKey && ...` — that
      // accepted a scoped message from another user when our own email
      // hadn't loaded yet (logged-out tab, hydration race). Reject
      // whenever EITHER side has a key that doesn't match the other.
      if ((myKey || theirKey) && myKey !== theirKey) return;
      // Phase 11+ dept gate: never adopt a sibling tab's payload when
      // the dept doesn't match — otherwise an HRX tab would pick up a
      // GIX-scoped payload from a sibling and paint the wrong data.
      const myDept = currentDeptId || '';
      const theirDept = msg.deptKey || '';
      if ((myDept || theirDept) && myDept !== theirDept) return;
      if (msg.ts && msg.ts > lastFetchRef.current) {
        setItems(msg.items || []);
        lastFetchRef.current = msg.ts;
        setLastSyncAt(msg.ts);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, [userEmail, currentDeptId]);

  // Severity helper
  const getSeverity = (item) => item.action?.severity || 'active';

  // Group by country
  const byCountry = useMemo(() => {
    const map = {};
    for (const item of items) {
      const ctry = item.country || '??';
      if (!map[ctry]) map[ctry] = [];
      map[ctry].push(item);
    }
    return Object.entries(map)
      .sort(([, aItems], [, bItems]) => {
        const aHasCrit = aItems.some(i => getSeverity(i) === 'critical' || getSeverity(i) === 'warning');
        const bHasCrit = bItems.some(i => getSeverity(i) === 'critical' || getSeverity(i) === 'warning');
        if (aHasCrit && !bHasCrit) return -1;
        if (!aHasCrit && bHasCrit) return 1;
        return bItems.length - aItems.length;
      })
      .map(([country, people]) => ({
        country,
        people: people.sort((a, b) => {
          const sevOrder = { critical: 0, warning: 1, active: 2, info: 3 };
          return (sevOrder[getSeverity(a)] ?? 9) - (sevOrder[getSeverity(b)] ?? 9);
        }),
        overdueCount: people.filter(p => getSeverity(p) === 'critical').length,
        atRiskCount: people.filter(p => getSeverity(p) === 'warning').length,
      }));
  }, [items]);

  // Summary counts by severity
  const counts = useMemo(() => {
    const c = { total: items.length, critical: 0, warning: 0, active: 0, info: 0 };
    for (const i of items) {
      const sev = getSeverity(i);
      if (c[sev] !== undefined) c[sev]++;
    }
    return c;
  }, [items]);

  return {
    items,
    byCountry,
    counts,
    loading,
    isRefreshing,
    error,
    lastSyncAt,
    refresh: () => refresh(true),
    isAvailable: items.length > 0 || !error,
  };
}

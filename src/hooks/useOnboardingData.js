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

const SOURCE_ID = 'onboarding';
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY_BASE = 'ops_hub_onboarding_cache';
const cacheKeyFor = (userEmail) =>
  userEmail ? `${CACHE_KEY_BASE}:${String(userEmail).toLowerCase()}` : CACHE_KEY_BASE;

export function useOnboardingData(enabled = true, userEmail = null) {
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

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return null;
    if (!force && Date.now() - lastFetchRef.current < CACHE_TTL) return null;
    if (!force && inFlightRef.current) return inFlightRef.current;

    setIsRefreshing(true);
    setLoading(prev => items.length === 0 ? true : prev);
    setError(null);

    const run = (async () => {
      try {
        const res = await fetchDeelOnboarding();
        const fetched = res?.items || [];
        const now = Date.now();
        if (fetched.length > 0 || items.length === 0) {
          setItems(fetched);
          // Fire-and-forget IDB write — doesn't block the data path.
          idbSet(cacheKeyFor(userEmail), { items: fetched, ts: now }).catch(() => {});
          broadcastSync(SOURCE_ID, fetched, null, userEmail);
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
  }, [enabled, items.length, userEmail]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── IDB cache hydration ───────────────────────────────────────────────────
  // Async-loads the cached payload after mount and merges into state if the
  // live fetch hasn't arrived yet. Includes legacy-localStorage migration
  // (one-shot copy from old key, then cleanup).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await idbGetWithMigration(cacheKeyFor(userEmail));
      if (cancelled) return;
      if (liveReceivedRef.current) return;        // sync beat us — don't overwrite
      if (!cached?.items?.length) return;
      setItems(cached.items);
      lastFetchRef.current = cached.ts || 0;
      setLastSyncAt(cached.ts || null);
    })();
    return () => { cancelled = true; };
  }, [userEmail]);

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
  // different signed-in user so we never pick up their scoped payload.
  useEffect(() => {
    const ch = getQueueChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg || msg.source !== SOURCE_ID) return;
      const myKey = (userEmail || '').toLowerCase();
      const theirKey = (msg.userKey || '').toLowerCase();
      if (myKey && theirKey && myKey !== theirKey) return;
      if (msg.ts && msg.ts > lastFetchRef.current) {
        setItems(msg.items || []);
        lastFetchRef.current = msg.ts;
        setLastSyncAt(msg.ts);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, [userEmail]);

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

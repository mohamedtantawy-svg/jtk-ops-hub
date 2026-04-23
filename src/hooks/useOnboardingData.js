// ── useOnboardingData hook ──────────────────────────────────────────────────
// Fetches onboarding actionable queue from the Deel Admin API.
// Groups by country. Caches in localStorage.
// Stale-while-revalidate: always shows previous data until fresh data arrives.
// De-dupes concurrent refresh() calls and adopts cross-tab broadcasts.
// Auto-refreshes every CACHE_TTL while the tab is visible so long-lived tabs
// don't show a stale "X mins ago" banner.
// Cache key is user-scoped so different signed-in users on the same browser
// never inherit each other's server-scoped payload.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelOnboarding } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';

const SOURCE_ID = 'onboarding';
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY_BASE = 'ops_hub_onboarding_cache';
const cacheKeyFor = (userEmail) =>
  userEmail ? `${CACHE_KEY_BASE}:${String(userEmail).toLowerCase()}` : CACHE_KEY_BASE;

function loadCache(userEmail) {
  try {
    const cached = localStorage.getItem(cacheKeyFor(userEmail));
    if (cached) {
      const parsed = JSON.parse(cached);
      // Return cached data regardless of TTL — stale data is better than empty
      if (parsed.items?.length > 0) return { items: parsed.items, ts: parsed.ts || 0 };
    }
  } catch (e) {}
  return { items: [], ts: 0 };
}

export function useOnboardingData(enabled = true, userEmail = null) {
  const cached = useMemo(() => loadCache(userEmail), [userEmail]);
  const [items, setItems] = useState(cached.items);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(cached.ts || null);
  const lastFetchRef = useRef(cached.ts > 0 && Date.now() - cached.ts < CACHE_TTL ? cached.ts : 0);
  const inFlightRef = useRef(null);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return null;
    if (!force && Date.now() - lastFetchRef.current < CACHE_TTL) return null;
    if (inFlightRef.current) return inFlightRef.current;

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
          try {
            localStorage.setItem(cacheKeyFor(userEmail), JSON.stringify({ items: fetched, ts: now }));
          } catch (e) {}
          broadcastSync(SOURCE_ID, fetched, null, userEmail);
        }
        lastFetchRef.current = now;
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

// ── useChangeRequestData hook ────────────────────────────────────────────────
// Fetches amendments + redlines from the Deel Admin API.
// Groups by country. Caches in localStorage.
// Stale-while-revalidate: always shows previous data until fresh data arrives.
// De-dupes concurrent refresh() calls and adopts cross-tab broadcasts.
// Amendments and redlines track their own lastFetchRef so an out-of-order
// broadcast for one doesn't block the other from updating.
// Auto-refreshes while visible and user-scopes the cache so signed-in users
// never inherit each other's server-scoped payload.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelAmendments, fetchDeelRedlines } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';

const SOURCE_AMENDMENTS = 'amendments';
const SOURCE_REDLINES = 'redlines';
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY_AMENDMENTS_BASE = 'ops_hub_amendments_cache';
const CACHE_KEY_REDLINES_BASE = 'ops_hub_redlines_cache';
const cacheKeyFor = (base, userEmail) =>
  userEmail ? `${base}:${String(userEmail).toLowerCase()}` : base;

function loadCache(key) {
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.items?.length > 0) return { items: parsed.items, ts: parsed.ts || 0 };
    }
  } catch (e) {}
  return { items: [], ts: 0 };
}

export function useChangeRequestData(enabled = true, userEmail = null) {
  const cachedA = useMemo(() => loadCache(cacheKeyFor(CACHE_KEY_AMENDMENTS_BASE, userEmail)), [userEmail]);
  const cachedR = useMemo(() => loadCache(cacheKeyFor(CACHE_KEY_REDLINES_BASE, userEmail)), [userEmail]);
  const [amendments, setAmendments] = useState(cachedA.items);
  const [redlines, setRedlines] = useState(cachedR.items);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(() => {
    if (cachedA.ts && cachedR.ts) return Math.max(cachedA.ts, cachedR.ts);
    return cachedA.ts || cachedR.ts || null;
  });
  const lastFetchAmendmentsRef = useRef(
    cachedA.ts > 0 && Date.now() - cachedA.ts < CACHE_TTL ? cachedA.ts : 0
  );
  const lastFetchRedlinesRef = useRef(
    cachedR.ts > 0 && Date.now() - cachedR.ts < CACHE_TTL ? cachedR.ts : 0
  );
  const inFlightRef = useRef(null);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return null;
    const bothFresh = !force
      && Date.now() - lastFetchAmendmentsRef.current < CACHE_TTL
      && Date.now() - lastFetchRedlinesRef.current < CACHE_TTL;
    if (bothFresh) return null;
    if (inFlightRef.current) return inFlightRef.current;

    setIsRefreshing(true);
    setLoading(prev => (amendments.length === 0 && redlines.length === 0) ? true : prev);
    setError(null);

    const run = (async () => {
      try {
        const [amendResult, redlineResult] = await Promise.allSettled([
          fetchDeelAmendments({ bustCache: force }),
          fetchDeelRedlines({ bustCache: force }),
        ]);

        const fetchedAmendments = amendResult.status === 'fulfilled' ? (amendResult.value?.items || []) : [];
        const fetchedRedlines = redlineResult.status === 'fulfilled' ? (redlineResult.value?.items || []) : [];

        if (amendResult.status === 'rejected') console.warn('[useChangeRequestData] Amendments fetch failed:', amendResult.reason?.message);
        if (redlineResult.status === 'rejected') console.warn('[useChangeRequestData] Redlines fetch failed:', redlineResult.reason?.message);

        const now = Date.now();
        if (amendResult.status === 'fulfilled' && (fetchedAmendments.length > 0 || amendments.length === 0)) {
          setAmendments(fetchedAmendments);
          try { localStorage.setItem(cacheKeyFor(CACHE_KEY_AMENDMENTS_BASE, userEmail), JSON.stringify({ items: fetchedAmendments, ts: now })); } catch (e) {}
          broadcastSync(SOURCE_AMENDMENTS, fetchedAmendments, null, userEmail);
          lastFetchAmendmentsRef.current = now;
        }
        if (redlineResult.status === 'fulfilled' && (fetchedRedlines.length > 0 || redlines.length === 0)) {
          setRedlines(fetchedRedlines);
          try { localStorage.setItem(cacheKeyFor(CACHE_KEY_REDLINES_BASE, userEmail), JSON.stringify({ items: fetchedRedlines, ts: now })); } catch (e) {}
          broadcastSync(SOURCE_REDLINES, fetchedRedlines, null, userEmail);
          lastFetchRedlinesRef.current = now;
        }
        setLastSyncAt(Math.max(lastFetchAmendmentsRef.current, lastFetchRedlinesRef.current) || null);

        // Surface an error only when BOTH legs fall over — one succeeding keeps the card informative.
        if (amendResult.status === 'rejected' && redlineResult.status === 'rejected') {
          setError(amendResult.reason?.message || 'Change requests fetch failed');
        }
        return { amendments: fetchedAmendments, redlines: fetchedRedlines };
      } catch (err) {
        console.warn('[useChangeRequestData] Failed:', err.message);
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
  }, [enabled, amendments.length, redlines.length, userEmail]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh while the tab is visible so the unified sync indicator
  // doesn't age into the "stale" state while the user is working.
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

  // Cross-tab adoption — amendments and redlines are tracked by independent
  // refs so an out-of-order broadcast for one never blocks the other. Reject
  // broadcasts from a different signed-in user to prevent cache bleed-through.
  useEffect(() => {
    const ch = getQueueChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg) return;
      const myKey = (userEmail || '').toLowerCase();
      const theirKey = (msg.userKey || '').toLowerCase();
      if (myKey && theirKey && myKey !== theirKey) return;
      if (msg.source === SOURCE_AMENDMENTS && msg.ts && msg.ts > lastFetchAmendmentsRef.current) {
        setAmendments(msg.items || []);
        lastFetchAmendmentsRef.current = msg.ts;
        setLastSyncAt(Math.max(lastFetchAmendmentsRef.current, lastFetchRedlinesRef.current) || null);
      } else if (msg.source === SOURCE_REDLINES && msg.ts && msg.ts > lastFetchRedlinesRef.current) {
        setRedlines(msg.items || []);
        lastFetchRedlinesRef.current = msg.ts;
        setLastSyncAt(Math.max(lastFetchAmendmentsRef.current, lastFetchRedlinesRef.current) || null);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, [userEmail]);

  // ── Amendments grouped by country ──
  const amendmentsByCountry = useMemo(() => {
    return groupByCountry(amendments, item => item.displayStatus?.severity);
  }, [amendments]);

  // ── Redlines grouped by country ──
  const redlinesByCountry = useMemo(() => {
    return groupByCountry(redlines, item => item.displayStatus?.severity, 'countryCode');
  }, [redlines]);

  // ── Amendment counts by status label ──
  const amendmentCounts = useMemo(() => {
    const c = { total: amendments.length, amendmentRequested: 0, waitingHrx: 0, pendingSow: 0, pendingEa: 0, paused: 0, other: 0 };
    for (const a of amendments) {
      const label = (a.displayStatus?.label || '').toLowerCase();
      if (label.includes('amendment requested')) c.amendmentRequested++;
      else if (label.includes('waiting hrx')) c.waitingHrx++;
      else if (label.includes('pending sow')) c.pendingSow++;
      else if (label.includes('pending ea')) c.pendingEa++;
      else if (label.includes('paused')) c.paused++;
      else c.other++;
    }
    return c;
  }, [amendments]);

  // ── Redline counts by status ──
  const redlineCounts = useMemo(() => {
    const c = { total: redlines.length, redlineReview: 0, redlineExecution: 0, other: 0 };
    for (const r of redlines) {
      const label = (r.displayStatus?.label || '').toLowerCase();
      if (label.includes('redline review')) c.redlineReview++;
      else if (label.includes('redline execution')) c.redlineExecution++;
      else c.other++;
    }
    return c;
  }, [redlines]);

  return {
    amendments,
    redlines,
    amendmentsByCountry,
    redlinesByCountry,
    amendmentCounts,
    redlineCounts,
    loading,
    isRefreshing,
    error,
    lastSyncAt,
    refresh: () => refresh(true),
    isAvailable: (amendments.length > 0 || redlines.length > 0) || !error,
  };
}

// ── Helpers ──

function groupByCountry(items, getSeverity, countryField = 'country') {
  const map = {};
  for (const item of items) {
    const ctry = item[countryField] || '??';
    if (!map[ctry]) map[ctry] = [];
    map[ctry].push(item);
  }
  return Object.entries(map)
    .sort(([, aItems], [, bItems]) => {
      const isUrgent = i => {
        const sev = typeof getSeverity === 'function' ? getSeverity(i) : 'active';
        return sev === 'critical' || sev === 'warning';
      };
      const aUrgent = aItems.some(isUrgent);
      const bUrgent = bItems.some(isUrgent);
      if (aUrgent && !bUrgent) return -1;
      if (!aUrgent && bUrgent) return 1;
      return bItems.length - aItems.length;
    })
    .map(([country, items]) => ({
      country,
      items,
      warningCount: items.filter(i => {
        const sev = typeof getSeverity === 'function' ? getSeverity(i) : 'active';
        return sev === 'warning';
      }).length,
    }));
}

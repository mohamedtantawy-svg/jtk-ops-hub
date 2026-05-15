// ── useOffboardingData hook ─────────────────────────────────────────────────
// Fetches active EOR termination cases from the Deel Admin API.
// Groups by country. Caches in IndexedDB (per-user).
// Stale-while-revalidate: always shows previous data until fresh data arrives.
// De-dupes concurrent refresh() calls and adopts cross-tab broadcasts.
// Auto-refreshes while visible and user-scopes the cache so signed-in users
// never inherit each other's server-scoped payload.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelOffboarding } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';
import { idbGetWithMigration, idbSet } from '../lib/idb-cache';

const SOURCE_ID = 'offboarding';
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY_BASE = 'ops_hub_offboarding_cache';
const cacheKeyFor = (userEmail) =>
  userEmail ? `${CACHE_KEY_BASE}:${String(userEmail).toLowerCase()}` : CACHE_KEY_BASE;

export function useOffboardingData(enabled = true, userEmail = null) {
  // IDB cache (was localStorage; moved to dodge the 5–10 MB shared cap).
  // Initial state is empty; the hydration effect below fills it ~10–50 ms
  // after mount. liveReceivedRef ensures a late-arriving cached payload
  // can't overwrite fresher data the network already returned.
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(null);
  const liveReceivedRef = useRef(false);
  // Mirror items via ref so refresh() can read the current count without
  // listing items.length in its deps. See useOnboardingData for the
  // detailed rationale (avoids refresh-callback identity churn on every
  // sync; keeps the post-fetch empty-payload guard honest across
  // overlapping in-flight refreshes).
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return null;
    if (!force && Date.now() - lastFetchRef.current < CACHE_TTL) return null;
    // force=true bypasses the in-flight guard so Force resync can recover
    // from a hung Promise instead of attaching to it. The previous Promise
    // keeps running until apiFetch's 90s timeout resolves it (we don't
    // try to abort here — the server's 45s ceiling means the response
    // path is short anyway).
    if (!force && inFlightRef.current) return inFlightRef.current;

    setIsRefreshing(true);
    setLoading(prev => itemsRef.current.length === 0 ? true : prev);
    setError(null);

    const run = (async () => {
      try {
        const res = await fetchDeelOffboarding({ bustCache: force });
        const fetched = res?.items || [];
        const now = Date.now();
        // Server returns { _warming: true } on cold-cache scan timeout. Don't
        // treat that as failure — terminations_v3 takes a few minutes to
        // populate on cold cache. The spinner stays, the next poll lands on
        // fresh data. Was previously firing the
        // "[useOffboardingData] Failed: ... timed out and no cached data" warn
        // every 30s during the warm-up window, which was misleading.
        if (res?._warming) {
          lastFetchRef.current = now;
          return itemsRef.current;
        }
        // `force` lets user-triggered refreshes overwrite empty fetches —
        // critical for any user action that legitimately empties the queue
        // (see useOnboardingData comment + the Reassign-not-working repro).
        if (force || fetched.length > 0 || itemsRef.current.length === 0) {
          setItems(fetched);
          idbSet(cacheKeyFor(userEmail), { items: fetched, ts: now }).catch(() => {});
          broadcastSync(SOURCE_ID, fetched, null, userEmail);
        }
        lastFetchRef.current = now;
        liveReceivedRef.current = true;
        setLastSyncAt(now);
        return fetched;
      } catch (err) {
        console.warn('[useOffboardingData] Failed:', err.message);
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
  }, [enabled, userEmail]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── IDB cache hydration ───────────────────────────────────────────────────
  // Async-loads the cached payload after mount. Includes one-shot legacy
  // localStorage migration. Skipped if the live fetch beat IDB.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await idbGetWithMigration(cacheKeyFor(userEmail));
      if (cancelled) return;
      if (liveReceivedRef.current) return;
      if (!cached?.items?.length) return;
      setItems(cached.items);
      lastFetchRef.current = cached.ts || 0;
      setLastSyncAt(cached.ts || null);
    })();
    return () => { cancelled = true; };
  }, [userEmail]);

  // Auto-refresh while the tab is visible so the sync indicator stays green.
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
      if (msg.ts && msg.ts > lastFetchRef.current) {
        setItems(msg.items || []);
        lastFetchRef.current = msg.ts;
        setLastSyncAt(msg.ts);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, [userEmail]);

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
        // Countries with critical/warning cases first
        const isUrgent = i => i.status?.severity === 'critical' || i.status?.severity === 'warning';
        const aUrgent = aItems.some(isUrgent);
        const bUrgent = bItems.some(isUrgent);
        if (aUrgent && !bUrgent) return -1;
        if (!aUrgent && bUrgent) return 1;
        return bItems.length - aItems.length; // then by count desc
      })
      .map(([country, people]) => ({
        country,
        people,
        urgentCount: people.filter(p => p.status?.severity === 'critical').length,
        warningCount: people.filter(p => p.status?.severity === 'warning').length,
      }));
  }, [items]);

  // Summary counts — use the server-computed status label
  const counts = useMemo(() => {
    const c = { total: items.length, critical: 0, awaitingTriage: 0, processing: 0, other: 0 };
    for (const i of items) {
      const sev = i.status?.severity;
      const label = i.adminStatus || '';
      if (sev === 'critical') c.critical++;
      else if (label === 'AWAITING_TRIAGE') c.awaitingTriage++;
      else if (label === 'PROCESSING' || label === 'IN_PROGRESS') c.processing++;
      else c.other++;
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

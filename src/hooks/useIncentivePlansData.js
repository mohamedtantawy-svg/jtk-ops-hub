// ── useIncentivePlansData hook ──────────────────────────────────────────────
// Fetches incentive-plan rows pending IP preparation from the Deel Admin API.
// Mirrors the useChangeRequestData / useWorkbenchData pattern — IndexedDB
// cache (per-user), stale-while-revalidate, in-flight dedup, cross-tab
// adoption via the shared queue channel.
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchDeelIncentivePlans } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';
import { idbGetWithMigration, idbSet } from '../lib/idb-cache';
import { useCurrentDeptId } from '../lib/current-dept-storage';
import { shouldAdoptFetchedItems } from './adoptFetchedItems';

const SOURCE_ID = 'incentivePlans';
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY_BASE = 'ops_hub_incentive_plans_cache';
// Phase 11+ instant-switch (2026-05-21): per-dept cache namespace.
const cacheKeyFor = (userEmail, deptId) => {
  const u = userEmail ? `:${String(userEmail).toLowerCase()}` : '';
  const d = deptId ? `:${deptId}` : ':no-dept';
  return `${CACHE_KEY_BASE}${u}${d}`;
};

export function useIncentivePlansData(enabled = true, userEmail = null) {
  const currentDeptId = useCurrentDeptId();
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
  // detailed rationale.
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
        const res = await fetchDeelIncentivePlans({ bustCache: force });
        const fetched = res?.items || [];
        const now = Date.now();
        // `force` lets user-triggered refreshes overwrite empty fetches —
        // critical for the post-Reassign sync path where the row legitimately
        // drops out of the caller's scope (see useOnboardingData comment).
        if (shouldAdoptFetchedItems({ force, fetchedLength: fetched.length, currentLength: itemsRef.current.length, key: `${SOURCE_ID}:${userEmail || ''}:${currentDeptId || ''}` })) {
          setItems(fetched);
          idbSet(cacheKeyFor(userEmail, currentDeptId), { items: fetched, ts: now }).catch(() => {});
          broadcastSync(SOURCE_ID, fetched, null, userEmail, currentDeptId);
        }
        lastFetchRef.current = now;
        liveReceivedRef.current = true;
        setLastSyncAt(now);
        return fetched;
      } catch (err) {
        console.warn('[useIncentivePlansData] Failed:', err.message);
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

  // ── IDB cache hydration ─────────────────────────────────────────────────
  // Re-runs on dept change to swap to the target dept's persisted cache.
  useEffect(() => {
    let cancelled = false;
    inFlightRef.current = null;
    liveReceivedRef.current = false;
    (async () => {
      const cached = await idbGetWithMigration(cacheKeyFor(userEmail, currentDeptId));
      if (cancelled) return;
      if (liveReceivedRef.current) return;
      if (!cached?.items?.length) {
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

  // Auto-refresh while visible.
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

  // Cross-tab adoption.
  useEffect(() => {
    const ch = getQueueChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg || msg.source !== SOURCE_ID) return;
      const myKey = (userEmail || '').toLowerCase();
      const theirKey = (msg.userKey || '').toLowerCase();
      if ((myKey || theirKey) && myKey !== theirKey) return;
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

  return {
    items,
    loading,
    isRefreshing,
    error,
    lastSyncAt,
    refresh: () => refresh(true),
    isAvailable: items.length > 0 || !error,
  };
}

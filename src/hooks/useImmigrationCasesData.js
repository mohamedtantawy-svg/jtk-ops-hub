// ── useImmigrationCasesData hook ───────────────────────────────────────────
// 2026-06-03: GIX-only data source. Mirrors useImmigrationTasksData exactly
// (SWR, IDB cache, BroadcastChannel sync, dept-namespaced cache, 3-strike
// error debounce, auto-refresh while visible) so the FE layers downstream —
// ImmigrationCasesTable rendering, sync-badge tracking, home counts — read it
// through the same idioms as every other Deel queue. HRX gets `disabled: true`
// from the route + empty cache, so this hook is a no-op for HRX scope.
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchDeelImmigrationCases } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';
import { idbGetWithMigration, idbSet } from '../lib/idb-cache';
import { useCurrentDeptId } from '../lib/current-dept-storage';
import { shouldAdoptFetchedItems } from './adoptFetchedItems';

const SOURCE_ID = 'immigration_cases';
const CACHE_TTL = 3 * 60 * 1000;
const CACHE_KEY_BASE = 'ops_hub_immigration_cases_cache';
// Per-dept namespace so an HRX viewer (empty cache) never sees GIX rows from a
// stale cache after a dept switch.
const cacheKeyFor = (userEmail, deptId) => {
  const u = userEmail ? `:${String(userEmail).toLowerCase()}` : '';
  const d = deptId ? `:${deptId}` : ':no-dept';
  return `${CACHE_KEY_BASE}${u}${d}`;
};

export function useImmigrationCasesData(enabled = true, userEmail = null) {
  const currentDeptId = useCurrentDeptId();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(null);
  const liveReceivedRef = useRef(false);
  const failStreakRef = useRef(0);
  const casesRef = useRef(cases);
  useEffect(() => { casesRef.current = cases; }, [cases]);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return null;
    if (!force && Date.now() - lastFetchRef.current < CACHE_TTL) return null;
    if (!force && inFlightRef.current) return inFlightRef.current;

    setIsRefreshing(true);
    setLoading(prev => casesRef.current.length === 0 ? true : prev);
    setError(null);

    const run = (async () => {
      try {
        // take = upstream page size for the cursor walk. 100 is honoured by
        // /admin/mobility/cases (the earlier take=20 made the walk too many
        // slow pages → build timeout → "0 Waiting"). The route walks via cursor.
        const res = await fetchDeelImmigrationCases({ take: 100, bustCache: force });
        const fetched = res?.items || [];
        const now = Date.now();
        // Warming-payload short-circuit — don't blow away cached rows.
        if (res?._warming) {
          lastFetchRef.current = now;
          return casesRef.current;
        }
        // Disabled / dept-not-supported response: server hard-says zero for
        // this scope. Drop stale rows so the FE renders empty, not leak.
        if (res?.disabled) {
          setCases([]);
          idbSet(cacheKeyFor(userEmail, currentDeptId), { items: [], ts: now }).catch(() => {});
          lastFetchRef.current = now;
          liveReceivedRef.current = true;
          setLastSyncAt(now);
          failStreakRef.current = 0;
          if (error) setError(null);
          return [];
        }
        if (shouldAdoptFetchedItems({ force, fetchedLength: fetched.length, currentLength: casesRef.current.length, key: `${SOURCE_ID}:${userEmail || ''}:${currentDeptId || ''}` })) {
          setCases(fetched);
          idbSet(cacheKeyFor(userEmail, currentDeptId), { items: fetched, ts: now }).catch(() => {});
          broadcastSync(SOURCE_ID, fetched, null, userEmail, currentDeptId);
        }
        lastFetchRef.current = now;
        liveReceivedRef.current = true;
        setLastSyncAt(now);
        failStreakRef.current = 0;
        if (error) setError(null);
        return fetched;
      } catch (err) {
        failStreakRef.current += 1;
        console.warn('[useImmigrationCasesData] Failed:', err.message, `(streak ${failStreakRef.current})`);
        if (failStreakRef.current >= 3) setError(err.message);
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

  // IDB cache hydration with dept-namespaced key — instant repaint when the
  // user flips back to a previously-visited dept.
  useEffect(() => {
    let cancelled = false;
    inFlightRef.current = null;
    liveReceivedRef.current = false;
    (async () => {
      const cached = await idbGetWithMigration(cacheKeyFor(userEmail, currentDeptId));
      if (cancelled) return;
      if (liveReceivedRef.current) return;
      if (!cached?.items?.length) {
        setCases([]);
        setLastSyncAt(null);
        lastFetchRef.current = 0;
        return;
      }
      setCases(cached.items);
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

  // Cross-tab sync — adopt any newer payload broadcast for the same
  // user + dept combination.
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
        setCases(msg.items || []);
        lastFetchRef.current = msg.ts;
        setLastSyncAt(msg.ts);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, [userEmail, currentDeptId]);

  return { cases, loading, isRefreshing, error, lastSyncAt, refresh };
}

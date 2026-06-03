// ── useImmigrationTasksData hook ───────────────────────────────────────────
// 2026-05-22 (evening): GIX-only data source. Mirrors useWorkbenchData
// shape (SWR, IDB cache, BroadcastChannel sync, dept-namespaced cache,
// 3-strike error debounce, auto-refresh while visible) so the FE layers
// downstream — SourceTable rendering, sync-badge tracking, BriefingView
// aggregation — read it through the same idioms as every other Deel
// queue. HRX gets `disabled: true` from the route + empty cache, so
// this hook is a no-op for HRX scope.
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchDeelImmigrationTasks } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';
import { idbGetWithMigration, idbSet } from '../lib/idb-cache';
import { useCurrentDeptId } from '../lib/current-dept-storage';

const SOURCE_ID = 'immigration_tasks';
const CACHE_TTL = 3 * 60 * 1000;
const CACHE_KEY_BASE = 'ops_hub_immigration_tasks_cache';
// Per-dept namespace so an HRX viewer (empty cache) never sees GIX rows
// from a stale cache after a dept switch.
const cacheKeyFor = (userEmail, deptId) => {
  const u = userEmail ? `:${String(userEmail).toLowerCase()}` : '';
  const d = deptId ? `:${deptId}` : ':no-dept';
  return `${CACHE_KEY_BASE}${u}${d}`;
};

export function useImmigrationTasksData(enabled = true, userEmail = null) {
  const currentDeptId = useCurrentDeptId();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(null);
  const liveReceivedRef = useRef(false);
  const failStreakRef = useRef(0);
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return null;
    if (!force && Date.now() - lastFetchRef.current < CACHE_TTL) return null;
    if (!force && inFlightRef.current) return inFlightRef.current;

    setIsRefreshing(true);
    setLoading(prev => tasksRef.current.length === 0 ? true : prev);
    setError(null);

    const run = (async () => {
      try {
        // take = upstream page size for the full walk (the route paginates
        // /admin/mobility/actions through every page). 100 = proven-accepted by
        // the endpoint (take=200 returned 400 on every page → sync "Failed").
        const res = await fetchDeelImmigrationTasks({ take: 100, bustCache: force });
        const fetched = res?.items || [];
        const now = Date.now();
        // Warming-payload short-circuit — same as workbench. Don't blow
        // away cached rows; keep the spinner ticking.
        if (res?._warming) {
          lastFetchRef.current = now;
          return tasksRef.current;
        }
        // Disabled / dept-not-supported response: server hard-says zero
        // for this scope. Drop any stale rows so the FE renders an empty
        // surface instead of leaking another dept's data.
        if (res?.disabled) {
          setTasks([]);
          idbSet(cacheKeyFor(userEmail, currentDeptId), { items: [], ts: now }).catch(() => {});
          lastFetchRef.current = now;
          liveReceivedRef.current = true;
          setLastSyncAt(now);
          failStreakRef.current = 0;
          if (error) setError(null);
          return [];
        }
        if (force || fetched.length > 0 || tasksRef.current.length === 0) {
          setTasks(fetched);
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
        console.warn('[useImmigrationTasksData] Failed:', err.message, `(streak ${failStreakRef.current})`);
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

  // IDB cache hydration with dept-namespaced key — instant repaint when
  // the user flips back to a previously-visited dept.
  useEffect(() => {
    let cancelled = false;
    inFlightRef.current = null;
    liveReceivedRef.current = false;
    (async () => {
      const cached = await idbGetWithMigration(cacheKeyFor(userEmail, currentDeptId));
      if (cancelled) return;
      if (liveReceivedRef.current) return;
      if (!cached?.items?.length) {
        setTasks([]);
        setLastSyncAt(null);
        lastFetchRef.current = 0;
        return;
      }
      setTasks(cached.items);
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
        setTasks(msg.items || []);
        lastFetchRef.current = msg.ts;
        setLastSyncAt(msg.ts);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, [userEmail, currentDeptId]);

  return { tasks, loading, isRefreshing, error, lastSyncAt, refresh };
}

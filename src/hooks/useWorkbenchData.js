// ── useWorkbenchData hook ─────────────────────────────────────────────────────
// Fetches OpsWorkbench tasks from the Deel Admin API.
// Groups by task type, then by country. Caches in IndexedDB (per-user).
// Stale-while-revalidate: always shows previous data until fresh data arrives.
// De-dupes concurrent refresh() calls and adopts cross-tab broadcasts.
// Auto-refreshes while visible and user-scopes the cache so signed-in users
// never inherit each other's server-scoped payload.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelWorkbench } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';
import { idbGetWithMigration, idbSet } from '../lib/idb-cache';

const SOURCE_ID = 'workbench';
const CACHE_TTL = 3 * 60 * 1000;
const CACHE_KEY_BASE = 'ops_hub_workbench_cache';
const cacheKeyFor = (userEmail) =>
  userEmail ? `${CACHE_KEY_BASE}:${String(userEmail).toLowerCase()}` : CACHE_KEY_BASE;

export function useWorkbenchData(enabled = true, userEmail = null) {
  // IDB cache (was localStorage). Empty initial state; the hydration effect
  // below fills it ~10–50 ms after mount, gated by liveReceivedRef so a late-
  // arriving cached payload can't overwrite fresher network data.
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(null);
  const liveReceivedRef = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return null;
    if (!force && Date.now() - lastFetchRef.current < CACHE_TTL) return null;
    if (!force && inFlightRef.current) return inFlightRef.current;

    setIsRefreshing(true);
    setLoading(prev => tasks.length === 0 ? true : prev);
    setError(null);

    const run = (async () => {
      try {
        const res = await fetchDeelWorkbench({ limit: 50, bustCache: force });
        const fetched = res?.items || [];
        const now = Date.now();
        if (fetched.length > 0 || tasks.length === 0) {
          setTasks(fetched);
          idbSet(cacheKeyFor(userEmail), { items: fetched, ts: now }).catch(() => {});
          broadcastSync(SOURCE_ID, fetched, null, userEmail);
        }
        lastFetchRef.current = now;
        liveReceivedRef.current = true;
        setLastSyncAt(now);
        return fetched;
      } catch (err) {
        console.warn('[useWorkbenchData] Failed:', err.message);
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
  }, [enabled, tasks.length, userEmail]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── IDB cache hydration ───────────────────────────────────────────────────
  // Async fill from IDB after mount, with one-shot legacy localStorage
  // migration. Skipped if the live fetch already returned.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await idbGetWithMigration(cacheKeyFor(userEmail));
      if (cancelled) return;
      if (liveReceivedRef.current) return;
      if (!cached?.items?.length) return;
      setTasks(cached.items);
      lastFetchRef.current = cached.ts || 0;
      setLastSyncAt(cached.ts || null);
    })();
    return () => { cancelled = true; };
  }, [userEmail]);

  // Auto-refresh while visible so long-open tabs don't show a stale indicator.
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
      if (myKey && theirKey && myKey !== theirKey) return;
      if (msg.ts && msg.ts > lastFetchRef.current) {
        setTasks(msg.items || []);
        lastFetchRef.current = msg.ts;
        setLastSyncAt(msg.ts);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, [userEmail]);

  // ── Status counts ──
  const counts = useMemo(() => {
    const c = { total: tasks.length, toDo: 0, inProgress: 0, onHold: 0, escalated: 0 };
    for (const t of tasks) {
      switch (t.status) {
        case 'TO_DO':       c.toDo++; break;
        case 'IN_PROGRESS': c.inProgress++; break;
        case 'ON_HOLD':     c.onHold++; break;
        case 'ESCALATED':   c.escalated++; break;
        default: break;
      }
    }
    return c;
  }, [tasks]);

  // ── Group by task type ──
  const byTaskType = useMemo(() => {
    const map = {};
    for (const t of tasks) {
      const key = t.taskType || 'Other';
      if (!map[key]) map[key] = [];
      map[key].push(t);
    }
    return Object.entries(map)
      .sort(([, a], [, b]) => {
        // Escalated items first, then by count
        const aEsc = a.some(i => i.status === 'ESCALATED');
        const bEsc = b.some(i => i.status === 'ESCALATED');
        if (aEsc && !bEsc) return -1;
        if (!aEsc && bEsc) return 1;
        return b.length - a.length;
      })
      .map(([taskType, items]) => ({
        taskType,
        items,
        escalatedCount: items.filter(i => i.status === 'ESCALATED').length,
      }));
  }, [tasks]);

  // ── Group by country ──
  const byCountry = useMemo(() => {
    const map = {};
    for (const t of tasks) {
      const ctry = t.country || '??';
      if (!map[ctry]) map[ctry] = [];
      map[ctry].push(t);
    }
    return Object.entries(map)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([country, items]) => ({ country, items }));
  }, [tasks]);

  return {
    tasks,
    counts,
    byTaskType,
    byCountry,
    loading,
    isRefreshing,
    error,
    lastSyncAt,
    refresh: () => refresh(true),
    isAvailable: (tasks.length > 0) || !error,
  };
}

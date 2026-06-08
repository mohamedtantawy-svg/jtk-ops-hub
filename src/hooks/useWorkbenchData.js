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
import { useCurrentDeptId } from '../lib/current-dept-storage';
import { shouldAdoptFetchedItems } from './adoptFetchedItems';

const SOURCE_ID = 'workbench';
const CACHE_TTL = 3 * 60 * 1000;
const CACHE_KEY_BASE = 'ops_hub_workbench_cache';
// Phase 11+ instant-switch (2026-05-21): per-dept cache namespace.
const cacheKeyFor = (userEmail, deptId) => {
  const u = userEmail ? `:${String(userEmail).toLowerCase()}` : '';
  const d = deptId ? `:${deptId}` : ':no-dept';
  return `${CACHE_KEY_BASE}${u}${d}`;
};

export function useWorkbenchData(enabled = true, userEmail = null) {
  const currentDeptId = useCurrentDeptId();
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
  // 3-strike debounce on transient failures (matches the leader-alerts
  // comment-poll pattern). A single timeout from a slow upstream no longer
  // flips the badge into error state — only persistent failure does. Reset
  // on first successful response. F38 in the 2026-05-03 live audit.
  const failStreakRef = useRef(0);
  // Mirror tasks via ref so refresh() can read the current count without
  // listing tasks.length in its deps. See useOnboardingData for the
  // detailed rationale.
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
        const res = await fetchDeelWorkbench({ limit: 50, bustCache: force });
        const fetched = res?.items || [];
        const now = Date.now();
        // Server returns { _warming: true } on cold-cache scan timeout. That's
        // an expected, transient state — not an error. Don't blow away cached
        // items, don't surface as a failure, just keep the spinner ticking
        // until the next poll picks up real data.
        if (res?._warming) {
          lastFetchRef.current = now;
          return tasksRef.current;
        }
        // `force` lets user-triggered refreshes overwrite empty fetches —
        // critical for any user action that legitimately empties the queue
        // (see useOnboardingData comment + the Reassign-not-working repro).
        if (shouldAdoptFetchedItems({ force, fetchedLength: fetched.length, currentLength: tasksRef.current.length, key: `${SOURCE_ID}:${userEmail || ''}:${currentDeptId || ''}` })) {
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
        // Only surface as a UI error after 3 consecutive failures so a single
        // slow upstream doesn't flip the sync badge red. Console warning still
        // fires on every miss for diagnostics.
        console.warn('[useWorkbenchData] Failed:', err.message, `(streak ${failStreakRef.current})`);
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

  // ── IDB cache hydration ───────────────────────────────────────────────────
  // Async fill from IDB after mount, with one-shot legacy localStorage
  // migration. Skipped if the live fetch already returned. Re-runs on
  // dept change to swap to the target dept's persisted cache.
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

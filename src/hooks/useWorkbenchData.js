// ── useWorkbenchData hook ─────────────────────────────────────────────────────
// Fetches OpsWorkbench tasks from the Deel Admin API.
// Groups by task type, then by country. Caches in localStorage.
// Stale-while-revalidate: always shows previous data until fresh data arrives.
// De-dupes concurrent refresh() calls and adopts cross-tab broadcasts.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelWorkbench } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';

const SOURCE_ID = 'workbench';
const CACHE_TTL = 3 * 60 * 1000;
const CACHE_KEY = 'ops_hub_workbench_cache';

function loadCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.items?.length > 0) return { items: parsed.items, ts: parsed.ts || 0 };
    }
  } catch (e) {}
  return { items: [], ts: 0 };
}

export function useWorkbenchData(enabled = true) {
  const cached = useMemo(() => loadCache(), []);
  const [tasks, setTasks] = useState(cached.items);
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
    setLoading(prev => tasks.length === 0 ? true : prev);
    setError(null);

    const run = (async () => {
      try {
        const res = await fetchDeelWorkbench({ limit: 50, bustCache: force });
        const fetched = res?.items || [];
        const now = Date.now();
        if (fetched.length > 0 || tasks.length === 0) {
          setTasks(fetched);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ items: fetched, ts: now }));
          } catch (e) {}
          broadcastSync(SOURCE_ID, fetched);
        }
        lastFetchRef.current = now;
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
  }, [enabled, tasks.length]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const ch = getQueueChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg || msg.source !== SOURCE_ID) return;
      if (msg.ts && msg.ts > lastFetchRef.current) {
        setTasks(msg.items || []);
        lastFetchRef.current = msg.ts;
        setLastSyncAt(msg.ts);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, []);

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

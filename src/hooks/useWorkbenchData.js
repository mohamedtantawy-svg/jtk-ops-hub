// ── useWorkbenchData hook ─────────────────────────────────────────────────────
// Fetches OpsWorkbench tasks from the Deel Admin API.
// Groups by task type, then by country. Caches in localStorage.
// Stale-while-revalidate: always shows previous data until fresh data arrives.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelWorkbench } from '../services/integrationsApi';

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
  const [error, setError] = useState(null);
  const lastFetch = useRef(cached.ts > 0 && Date.now() - cached.ts < CACHE_TTL ? cached.ts : 0);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force && Date.now() - lastFetch.current < CACHE_TTL) return;

    setLoading(prev => tasks.length === 0 ? true : prev);
    setError(null);
    try {
      const res = await fetchDeelWorkbench({ limit: 50, bustCache: force });
      const fetched = res?.items || [];

      if (fetched.length > 0 || tasks.length === 0) {
        setTasks(fetched);
      }
      lastFetch.current = Date.now();

      // Don't let a transient empty response wipe the good cached snapshot.
      if (fetched.length > 0 || tasks.length === 0) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ items: fetched, ts: Date.now() }));
        } catch (e) {}
      }
    } catch (err) {
      console.warn('[useWorkbenchData] Failed:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled, tasks.length]);

  useEffect(() => { refresh(); }, [refresh]);

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
    error,
    refresh: () => refresh(true),
    isAvailable: (tasks.length > 0) || !error,
  };
}

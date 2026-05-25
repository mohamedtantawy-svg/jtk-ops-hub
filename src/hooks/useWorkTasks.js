// ── useWorkTasks (Phase 1, 2026-05-25) ─────────────────────────────────────
// SWR hook for the new manual task system. Returns the dept-scoped task
// list + OOO emails for the rendered set + mutation helpers. Cross-tab
// sync via a BroadcastChannel; visibility-change triggers a refresh after
// a short TTL so a returning admin sees peer edits.
//
// User-scoped cache key (per skill rule #5) keeps multi-user laptops
// from cross-contaminating each other's snapshots.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listWorkTasks,
  createWorkTask,
  patchWorkTask,
  archiveWorkTask,
} from '../services/workTasksApi';

const REFRESH_TTL_MS = 60_000;
const CACHE_KEY_BASE = 'ops_hub_work_tasks_cache';
const SYNC_CHANNEL = 'ops_hub_work_tasks_sync';

function cacheKeyFor(email) {
  const lc = String(email || '').toLowerCase();
  return lc ? `${CACHE_KEY_BASE}:${lc}` : CACHE_KEY_BASE;
}

function readCache(email) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKeyFor(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch { return null; }
}

function writeCache(email, payload) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(cacheKeyFor(email), JSON.stringify({ ...payload, ts: Date.now() }));
  } catch {}
}

export function useWorkTasks(userEmail, { filters = {} } = {}) {
  const cached = readCache(userEmail);
  const [tasks, setTasks] = useState(() => cached?.tasks || []);
  const [oooEmails, setOooEmails] = useState(() => new Set(cached?.oooEmails || []));
  const [loading, setLoading] = useState(() => !(cached?.tasks?.length));
  const [error, setError] = useState(null);
  const lastFetchAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const channelRef = useRef(null);
  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  const reload = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const res = await listWorkTasks(filtersRef.current || {});
      const fresh = Array.isArray(res?.tasks) ? res.tasks : [];
      const ooo = new Set((res?.oooEmails || []).map(e => String(e).toLowerCase()));
      setTasks(fresh);
      setOooEmails(ooo);
      setError(null);
      lastFetchAtRef.current = Date.now();
      writeCache(userEmail, { tasks: fresh, oooEmails: Array.from(ooo) });
      if (channelRef.current) {
        try { channelRef.current.postMessage({ source: 'work-tasks', userEmail, tasks: fresh, ts: Date.now() }); } catch {}
      }
    } catch (err) {
      setError(err);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [userEmail]);

  // First fetch + cross-tab listener + visibility revisit.
  useEffect(() => {
    if (!userEmail) {
      setTasks([]); setOooEmails(new Set()); setLoading(false);
      return undefined;
    }
    reload();
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const msg = event.data;
      if (!msg || msg.source !== 'work-tasks') return;
      if ((msg.userEmail || '').toLowerCase() !== (userEmail || '').toLowerCase()) return;
      if (Array.isArray(msg.tasks)) {
        setTasks(msg.tasks);
      }
    };
    return () => {
      try { channel.close(); } catch {}
      channelRef.current = null;
    };
  }, [userEmail, reload]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchAtRef.current < REFRESH_TTL_MS) return;
      reload();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [reload]);

  // Refilter on the server when filters change — except for filters the FE
  // can apply locally (search box, scope toggle) which we let the FE handle
  // for instant feedback. Server-side filters re-fire reload.
  useEffect(() => {
    if (!userEmail) return undefined;
    const timer = setTimeout(() => { reload(); }, 0);
    return () => clearTimeout(timer);
  }, [userEmail, filters.status, filters.priority, filters.projectId, filters.includeArchived, reload]);

  const create = useCallback(async (payload) => {
    const res = await createWorkTask(payload);
    await reload();
    return res?.task || null;
  }, [reload]);

  const update = useCallback(async (taskId, patch) => {
    const res = await patchWorkTask(taskId, patch);
    await reload();
    return res?.task || null;
  }, [reload]);

  const archive = useCallback(async (taskId) => {
    await archiveWorkTask(taskId);
    await reload();
  }, [reload]);

  // Derived counters convenient for the status filter cards on the view.
  const counts = useMemo(() => {
    const out = { todo: 0, in_progress: 0, blocked: 0, done: 0, archived: 0, total: 0 };
    for (const t of tasks) {
      if (t.isArchived) continue;
      if (out[t.status] != null) out[t.status] += 1;
      out.total += 1;
    }
    return out;
  }, [tasks]);

  return {
    tasks,
    oooEmails,
    counts,
    loading,
    error,
    reload,
    create,
    update,
    archive,
  };
}

// ── useUrgentAssistSchedule ─────────────────────────────────────────────
// Lightweight SWR hook for the Urgent Assist MOC schedule view. Single
// list fetch with a 5-minute LS cache (schedule changes rarely; the user
// can hit Refresh for an immediate poll). No BroadcastChannel — multi-
// tab consistency isn't critical for a calendar view.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listUrgentAssistSchedule } from '../services/urgentAssistScheduleApi';

const CACHE_KEY = 'ops_hub_urgent_assist_schedule_cache';
const CACHE_TTL_MS = 5 * 60 * 1000;

function readCache() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (parsed.ts && Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(items) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items, ts: Date.now() })); }
  catch {}
}

export function useUrgentAssistSchedule(enabled = true) {
  const cached = readCache();
  const [items, setItems] = useState(() => cached?.items || []);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    setError(null);
    try {
      const res = await listUrgentAssistSchedule();
      if (!mountedRef.current) return null;
      const next = Array.isArray(res?.items) ? res.items : [];
      setItems(next);
      writeCache(next);
      return next;
    } catch (err) {
      if (!mountedRef.current) return null;
      setError(err);
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { if (enabled) refresh(); }, [enabled, refresh]);

  return useMemo(() => ({
    items,
    loading,
    error,
    refresh: () => refresh(),
  }), [items, loading, error, refresh]);
}

// ── usePausedOnboardingData hook ────────────────────────────────────────────
// Fetches paused onboarding contracts from the Deel Admin API.
// Same pattern as useOnboardingData but for Onboarding.EA.EASigning.Paused.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelOnboardingPaused } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';

const SOURCE_ID = 'pausedOnboarding';
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY = 'ops_hub_onboarding_paused_cache';

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

export function usePausedOnboardingData(enabled = true) {
  const cached = useMemo(() => loadCache(), []);
  const [items, setItems] = useState(cached.items);
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
    setLoading(prev => items.length === 0 ? true : prev);
    setError(null);

    const run = (async () => {
      try {
        const res = await fetchDeelOnboardingPaused();
        const fetched = res?.items || [];
        const now = Date.now();
        if (fetched.length > 0 || items.length === 0) {
          setItems(fetched);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ items: fetched, ts: now }));
          } catch (e) {}
          broadcastSync(SOURCE_ID, fetched);
        }
        lastFetchRef.current = now;
        setLastSyncAt(now);
        return fetched;
      } catch (err) {
        console.warn('[usePausedOnboardingData] Failed:', err.message);
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
  }, [enabled, items.length]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const ch = getQueueChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg || msg.source !== SOURCE_ID) return;
      if (msg.ts && msg.ts > lastFetchRef.current) {
        setItems(msg.items || []);
        lastFetchRef.current = msg.ts;
        setLastSyncAt(msg.ts);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, []);

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

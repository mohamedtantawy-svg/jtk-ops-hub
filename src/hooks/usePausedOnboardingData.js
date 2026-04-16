// ── usePausedOnboardingData hook ────────────────────────────────────────────
// Fetches paused onboarding contracts from the Deel Admin API.
// Same pattern as useOnboardingData but for Onboarding.EA.EASigning.Paused.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelOnboardingPaused } from '../services/integrationsApi';

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
  const [error, setError] = useState(null);
  const lastFetch = useRef(cached.ts > 0 && Date.now() - cached.ts < CACHE_TTL ? cached.ts : 0);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force && Date.now() - lastFetch.current < CACHE_TTL) return;

    setLoading(prev => items.length === 0 ? true : prev);
    setError(null);
    try {
      const res = await fetchDeelOnboardingPaused();
      const fetched = res?.items || [];
      if (fetched.length > 0 || items.length === 0) {
        setItems(fetched);
      }
      lastFetch.current = Date.now();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ items: fetched, ts: Date.now() }));
      } catch (e) {}
    } catch (err) {
      console.warn('[usePausedOnboardingData] Failed:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled, items.length]);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    items,
    loading,
    error,
    refresh: () => refresh(true),
    isAvailable: items.length > 0 || !error,
  };
}

// ── useOnboardingData hook ──────────────────────────────────────────────────
// Fetches onboarding actionable queue from the Deel Admin API.
// Groups by country. Caches in localStorage.
// Stale-while-revalidate: always shows previous data until fresh data arrives.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelOnboarding } from '../services/integrationsApi';

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY = 'ops_hub_onboarding_cache';

function loadCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Return cached data regardless of TTL — stale data is better than empty
      if (parsed.items?.length > 0) return { items: parsed.items, ts: parsed.ts || 0 };
    }
  } catch (e) {}
  return { items: [], ts: 0 };
}

export function useOnboardingData(enabled = true) {
  const cached = useMemo(() => loadCache(), []);
  const [items, setItems] = useState(cached.items);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetch = useRef(cached.ts > 0 && Date.now() - cached.ts < CACHE_TTL ? cached.ts : 0);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force && Date.now() - lastFetch.current < CACHE_TTL) return;

    // Only show loading if we have zero items (first load ever)
    setLoading(prev => items.length === 0 ? true : prev);
    setError(null);
    try {
      const res = await fetchDeelOnboarding();
      const fetched = res?.items || [];
      // Only update if we got data — never replace good data with empty on error
      if (fetched.length > 0 || items.length === 0) {
        setItems(fetched);
      }
      lastFetch.current = Date.now();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ items: fetched, ts: Date.now() }));
      } catch (e) {}
    } catch (err) {
      console.warn('[useOnboardingData] Failed:', err.message);
      setError(err.message);
      // Keep existing items on error — never show empty
    } finally {
      setLoading(false);
    }
  }, [enabled, items.length]);

  useEffect(() => { refresh(); }, [refresh]);

  // Severity helper
  const getSeverity = (item) => item.action?.severity || 'active';

  // Group by country
  const byCountry = useMemo(() => {
    const map = {};
    for (const item of items) {
      const ctry = item.country || '??';
      if (!map[ctry]) map[ctry] = [];
      map[ctry].push(item);
    }
    return Object.entries(map)
      .sort(([, aItems], [, bItems]) => {
        const aHasCrit = aItems.some(i => getSeverity(i) === 'critical' || getSeverity(i) === 'warning');
        const bHasCrit = bItems.some(i => getSeverity(i) === 'critical' || getSeverity(i) === 'warning');
        if (aHasCrit && !bHasCrit) return -1;
        if (!aHasCrit && bHasCrit) return 1;
        return bItems.length - aItems.length;
      })
      .map(([country, people]) => ({
        country,
        people: people.sort((a, b) => {
          const sevOrder = { critical: 0, warning: 1, active: 2, info: 3 };
          return (sevOrder[getSeverity(a)] ?? 9) - (sevOrder[getSeverity(b)] ?? 9);
        }),
        overdueCount: people.filter(p => getSeverity(p) === 'critical').length,
        atRiskCount: people.filter(p => getSeverity(p) === 'warning').length,
      }));
  }, [items]);

  // Summary counts by severity
  const counts = useMemo(() => {
    const c = { total: items.length, critical: 0, warning: 0, active: 0, info: 0 };
    for (const i of items) {
      const sev = getSeverity(i);
      if (c[sev] !== undefined) c[sev]++;
    }
    return c;
  }, [items]);

  return {
    items,
    byCountry,
    counts,
    loading,
    error,
    refresh: () => refresh(true),
    isAvailable: items.length > 0 || !error,
  };
}

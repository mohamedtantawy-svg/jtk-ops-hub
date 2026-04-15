// ── useOnboardingData hook ──────────────────────────────────────────────────
// Fetches onboarding people from the Deel Admin API and groups by country.
// Caches results with a 5-minute TTL. Falls back gracefully.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelOnboarding } from '../services/integrationsApi';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = 'ops_hub_onboarding_cache';

export function useOnboardingData(enabled = true) {
  const [items, setItems] = useState(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL) {
          return parsed.items || [];
        }
      }
    } catch (e) {}
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetch = useRef(0);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force && Date.now() - lastFetch.current < CACHE_TTL) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetchDeelOnboarding({ limit: 200 });
      const fetched = res?.items || [];
      setItems(fetched);
      lastFetch.current = Date.now();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ items: fetched, ts: Date.now() }));
      } catch (e) {}
    } catch (err) {
      console.warn('[useOnboardingData] Failed:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  // Classify severity from action or hiringStatus — handles both
  // snake_case ("onboarding_overdue") and admin API labels ("Overdue")
  const getSeverity = (item) => {
    const sev = item.action?.severity;
    if (sev) return sev;
    const s = (item.hiringStatus || '').toLowerCase();
    if (s.includes('overdue') || s.includes('blocked')) return 'critical';
    if (s.includes('risk') || s.includes('awaiting')) return 'warning';
    if (s.includes('pending') || s.includes('invite')) return 'info';
    return 'active';
  };

  // Group by country
  const byCountry = useMemo(() => {
    const map = {};
    for (const item of items) {
      const ctry = item.country || '??';
      if (!map[ctry]) map[ctry] = [];
      map[ctry].push(item);
    }
    return Object.entries(map)
      .sort(([a, aItems], [b, bItems]) => {
        // Countries with critical items first
        const aHasCrit = aItems.some(i => getSeverity(i) === 'critical');
        const bHasCrit = bItems.some(i => getSeverity(i) === 'critical');
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

  // Summary counts — use action.severity from the server
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

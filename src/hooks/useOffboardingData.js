// ── useOffboardingData hook ─────────────────────────────────────────────────
// Fetches active EOR termination cases from the Deel Admin API.
// Groups by country. Caches in localStorage with 5-minute TTL.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelOffboarding } from '../services/integrationsApi';

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY = 'ops_hub_offboarding_cache';

export function useOffboardingData(enabled = true) {
  const [items, setItems] = useState(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL) return parsed.items || [];
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
      const res = await fetchDeelOffboarding({ bustCache: force });
      const fetched = res?.items || [];
      setItems(fetched);
      lastFetch.current = Date.now();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ items: fetched, ts: Date.now() }));
      } catch (e) {}
    } catch (err) {
      console.warn('[useOffboardingData] Failed:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

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
        // Countries with imminent/overdue cases first
        const aUrgent = aItems.some(i => (i.daysUntilEnd ?? 999) <= 14);
        const bUrgent = bItems.some(i => (i.daysUntilEnd ?? 999) <= 14);
        if (aUrgent && !bUrgent) return -1;
        if (!aUrgent && bUrgent) return 1;
        return bItems.length - aItems.length; // then by count desc
      })
      .map(([country, people]) => ({
        country,
        people: people.sort((a, b) => (a.daysUntilEnd ?? 9999) - (b.daysUntilEnd ?? 9999)),
        urgentCount: people.filter(p => (p.daysUntilEnd ?? 999) <= 14).length,
        warningCount: people.filter(p => (p.daysUntilEnd ?? 999) > 14 && (p.daysUntilEnd ?? 999) <= 30).length,
      }));
  }, [items]);

  // Summary counts
  const counts = useMemo(() => {
    const c = { total: items.length, overdue: 0, imminent: 0, awaiting: 0, inProgress: 0, scheduled: 0 };
    for (const i of items) {
      const d = i.daysUntilEnd;
      if (d === null) continue;
      if (d < 0) c.overdue++;
      else if (d <= 14) c.imminent++;
      else if (d <= 30) c.awaiting++;
      else if (d <= 90) c.inProgress++;
      else c.scheduled++;
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

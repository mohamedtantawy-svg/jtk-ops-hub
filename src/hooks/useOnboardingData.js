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

  // Group by country
  const byCountry = useMemo(() => {
    const map = {};
    for (const item of items) {
      const ctry = item.country || '??';
      if (!map[ctry]) map[ctry] = [];
      map[ctry].push(item);
    }
    // Sort countries alphabetically, but put items with overdue first
    return Object.entries(map)
      .sort(([a, aItems], [b, bItems]) => {
        const aHasOverdue = aItems.some(i => i.hiringStatus === 'onboarding_overdue');
        const bHasOverdue = bItems.some(i => i.hiringStatus === 'onboarding_overdue');
        if (aHasOverdue && !bHasOverdue) return -1;
        if (!aHasOverdue && bHasOverdue) return 1;
        return a.localeCompare(b);
      })
      .map(([country, people]) => ({
        country,
        people: people.sort((a, b) => {
          const order = { onboarding_overdue: 0, onboarding_at_risk: 1, onboarding: 2, pending_invite: 3 };
          return (order[a.hiringStatus] ?? 9) - (order[b.hiringStatus] ?? 9);
        }),
        overdueCount: people.filter(p => p.hiringStatus === 'onboarding_overdue').length,
        atRiskCount: people.filter(p => p.hiringStatus === 'onboarding_at_risk').length,
      }));
  }, [items]);

  // Summary counts
  const counts = useMemo(() => {
    const c = { total: items.length, onboarding: 0, overdue: 0, atRisk: 0, pendingInvite: 0 };
    for (const i of items) {
      if (i.hiringStatus === 'onboarding') c.onboarding++;
      else if (i.hiringStatus === 'onboarding_overdue') c.overdue++;
      else if (i.hiringStatus === 'onboarding_at_risk') c.atRisk++;
      else if (i.hiringStatus === 'pending_invite') c.pendingInvite++;
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

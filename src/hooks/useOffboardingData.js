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
        // Countries with critical/warning cases first
        const isUrgent = i => i.status?.severity === 'critical' || i.status?.severity === 'warning';
        const aUrgent = aItems.some(isUrgent);
        const bUrgent = bItems.some(isUrgent);
        if (aUrgent && !bUrgent) return -1;
        if (!aUrgent && bUrgent) return 1;
        return bItems.length - aItems.length; // then by count desc
      })
      .map(([country, people]) => ({
        country,
        people,
        urgentCount: people.filter(p => p.status?.severity === 'critical').length,
        warningCount: people.filter(p => p.status?.severity === 'warning').length,
      }));
  }, [items]);

  // Summary counts — use the server-computed status label
  const counts = useMemo(() => {
    const c = { total: items.length, critical: 0, awaitingTriage: 0, processing: 0, other: 0 };
    for (const i of items) {
      const sev = i.status?.severity;
      const label = i.adminStatus || '';
      if (sev === 'critical') c.critical++;
      else if (label === 'AWAITING_TRIAGE') c.awaitingTriage++;
      else if (label === 'PROCESSING' || label === 'IN_PROGRESS') c.processing++;
      else c.other++;
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

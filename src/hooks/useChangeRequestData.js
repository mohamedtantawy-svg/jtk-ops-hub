// ── useChangeRequestData hook ────────────────────────────────────────────────
// Fetches amendments + redlines from the Deel Admin API.
// Groups by country. Caches in localStorage.
// Stale-while-revalidate: always shows previous data until fresh data arrives.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelAmendments, fetchDeelRedlines } from '../services/integrationsApi';

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY_AMENDMENTS = 'ops_hub_amendments_cache';
const CACHE_KEY_REDLINES = 'ops_hub_redlines_cache';

function loadCache(key) {
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.items?.length > 0) return { items: parsed.items, ts: parsed.ts || 0 };
    }
  } catch (e) {}
  return { items: [], ts: 0 };
}

export function useChangeRequestData(enabled = true) {
  const cachedA = useMemo(() => loadCache(CACHE_KEY_AMENDMENTS), []);
  const cachedR = useMemo(() => loadCache(CACHE_KEY_REDLINES), []);
  const [amendments, setAmendments] = useState(cachedA.items);
  const [redlines, setRedlines] = useState(cachedR.items);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetch = useRef(
    cachedA.ts > 0 && cachedR.ts > 0 && Date.now() - Math.min(cachedA.ts, cachedR.ts) < CACHE_TTL
      ? Math.min(cachedA.ts, cachedR.ts) : 0
  );

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force && Date.now() - lastFetch.current < CACHE_TTL) return;

    // Only show loading if both are empty (first load ever)
    setLoading(prev => (amendments.length === 0 && redlines.length === 0) ? true : prev);
    setError(null);
    try {
      // Fetch both in parallel
      const [amendRes, redlineRes] = await Promise.all([
        fetchDeelAmendments({ bustCache: force }),
        fetchDeelRedlines({ bustCache: force }),
      ]);

      const fetchedAmendments = amendRes?.items || [];
      const fetchedRedlines = redlineRes?.items || [];

      // Only replace if we got data or current is empty
      if (fetchedAmendments.length > 0 || amendments.length === 0) {
        setAmendments(fetchedAmendments);
      }
      if (fetchedRedlines.length > 0 || redlines.length === 0) {
        setRedlines(fetchedRedlines);
      }
      lastFetch.current = Date.now();

      try {
        localStorage.setItem(CACHE_KEY_AMENDMENTS, JSON.stringify({ items: fetchedAmendments, ts: Date.now() }));
        localStorage.setItem(CACHE_KEY_REDLINES, JSON.stringify({ items: fetchedRedlines, ts: Date.now() }));
      } catch (e) {}
    } catch (err) {
      console.warn('[useChangeRequestData] Failed:', err.message);
      setError(err.message);
      // Keep existing data on error
    } finally {
      setLoading(false);
    }
  }, [enabled, amendments.length, redlines.length]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Amendments grouped by country ──
  const amendmentsByCountry = useMemo(() => {
    return groupByCountry(amendments, item => item.displayStatus?.severity);
  }, [amendments]);

  // ── Redlines grouped by country ──
  const redlinesByCountry = useMemo(() => {
    return groupByCountry(redlines, item => item.displayStatus?.severity, 'countryCode');
  }, [redlines]);

  // ── Amendment counts by status label ──
  const amendmentCounts = useMemo(() => {
    const c = { total: amendments.length, amendmentRequested: 0, waitingHrx: 0, pendingSow: 0, pendingEa: 0, paused: 0, other: 0 };
    for (const a of amendments) {
      const label = (a.displayStatus?.label || '').toLowerCase();
      if (label.includes('amendment requested')) c.amendmentRequested++;
      else if (label.includes('waiting hrx')) c.waitingHrx++;
      else if (label.includes('pending sow')) c.pendingSow++;
      else if (label.includes('pending ea')) c.pendingEa++;
      else if (label.includes('paused')) c.paused++;
      else c.other++;
    }
    return c;
  }, [amendments]);

  // ── Redline counts by status ──
  const redlineCounts = useMemo(() => {
    const c = { total: redlines.length, redlineReview: 0, redlineExecution: 0, other: 0 };
    for (const r of redlines) {
      const label = (r.displayStatus?.label || '').toLowerCase();
      if (label.includes('redline review')) c.redlineReview++;
      else if (label.includes('redline execution')) c.redlineExecution++;
      else c.other++;
    }
    return c;
  }, [redlines]);

  return {
    amendments,
    redlines,
    amendmentsByCountry,
    redlinesByCountry,
    amendmentCounts,
    redlineCounts,
    loading,
    error,
    refresh: () => refresh(true),
    isAvailable: (amendments.length > 0 || redlines.length > 0) || !error,
  };
}

// ── Helpers ──

function groupByCountry(items, getSeverity, countryField = 'country') {
  const map = {};
  for (const item of items) {
    const ctry = item[countryField] || '??';
    if (!map[ctry]) map[ctry] = [];
    map[ctry].push(item);
  }
  return Object.entries(map)
    .sort(([, aItems], [, bItems]) => {
      const isUrgent = i => {
        const sev = typeof getSeverity === 'function' ? getSeverity(i) : 'active';
        return sev === 'critical' || sev === 'warning';
      };
      const aUrgent = aItems.some(isUrgent);
      const bUrgent = bItems.some(isUrgent);
      if (aUrgent && !bUrgent) return -1;
      if (!aUrgent && bUrgent) return 1;
      return bItems.length - aItems.length;
    })
    .map(([country, items]) => ({
      country,
      items,
      warningCount: items.filter(i => {
        const sev = typeof getSeverity === 'function' ? getSeverity(i) : 'active';
        return sev === 'warning';
      }).length,
    }));
}

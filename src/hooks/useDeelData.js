// ── useDeelData hook ─────────────────────────────────────────────────────────
// Fetches live data from Deel Admin API and caches it in localStorage.
// Falls back gracefully if the integration is not configured.
// Staggered load: waits LOAD_DELAY ms before first fetch to avoid
// hammering APIs on page load when 6+ hooks all fire at once.
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchDeelPeople, fetchDeelContracts, fetchDeelTimeOff, fetchDeelOrg } from '../services/integrationsApi';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes (up from 3)
const CACHE_KEY = 'ops_hub_deel_data';
const LOAD_DELAY = 2000; // defer 2s — queue sync & onboarding are higher priority

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL) return parsed;
    }
  } catch {}
  return null;
}

export function useDeelData(enabled = true) {
  const cached = readCache();
  const [people, setPeople] = useState(cached?.people || null);
  const [contracts, setContracts] = useState(cached?.contracts || null);
  const [timeOff, setTimeOff] = useState(cached?.timeOff || null);
  const [org, setOrg] = useState(cached?.org || null);
  const [loading, setLoading] = useState(!cached && enabled);
  const [error, setError] = useState(null);
  const lastFetch = useRef(cached ? cached.ts : 0);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force && Date.now() - lastFetch.current < CACHE_TTL) return;

    setLoading(true);
    setError(null);
    try {
      const [pRes, cRes, toRes, oRes] = await Promise.allSettled([
        fetchDeelPeople({ limit: 200 }),
        fetchDeelContracts({ limit: 200 }),
        fetchDeelTimeOff({ limit: 100 }),
        fetchDeelOrg(),
      ]);

      const pData = pRes.status === 'fulfilled' ? (pRes.value?.data || pRes.value) : people;
      const cData = cRes.status === 'fulfilled' ? (cRes.value?.data || cRes.value) : contracts;
      const toData = toRes.status === 'fulfilled' ? (toRes.value?.data || toRes.value) : timeOff;
      const oData = oRes.status === 'fulfilled' ? (oRes.value?.data || oRes.value) : org;

      setPeople(pData);
      setContracts(cData);
      setTimeOff(toData);
      setOrg(oData);

      lastFetch.current = Date.now();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          people: pData, contracts: cData, timeOff: toData, org: oData, ts: Date.now(),
        }));
      } catch {}
    } catch (err) {
      console.warn('[useDeelData] Failed:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    // If we have cached data, defer the background refresh
    const delay = lastFetch.current > 0 ? CACHE_TTL - (Date.now() - lastFetch.current) : LOAD_DELAY;
    if (delay > 0 && lastFetch.current > 0) return; // cache still fresh, skip
    const timer = setTimeout(() => refresh(), Math.max(LOAD_DELAY, 100));
    return () => clearTimeout(timer);
  }, [refresh, enabled]);

  return {
    people, contracts, timeOff, org,
    loading, error, refresh: () => refresh(true),
    isAvailable: !!(people || contracts),
  };
}

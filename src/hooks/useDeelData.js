// ── useDeelData hook ─────────────────────────────────────────────────────────
// Fetches live data from Deel Admin API and caches it.
// Falls back gracefully if the integration is not configured.
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchDeelPeople, fetchDeelContracts, fetchDeelTimeOff, fetchDeelOrg } from '../services/integrationsApi';

const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

export function useDeelData(enabled = true) {
  const [people, setPeople] = useState(null);
  const [contracts, setContracts] = useState(null);
  const [timeOff, setTimeOff] = useState(null);
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetch = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (Date.now() - lastFetch.current < CACHE_TTL) return;

    setLoading(true);
    setError(null);
    try {
      const [pRes, cRes, toRes, oRes] = await Promise.allSettled([
        fetchDeelPeople({ limit: 200 }),
        fetchDeelContracts({ limit: 200 }),
        fetchDeelTimeOff({ limit: 100 }),
        fetchDeelOrg(),
      ]);

      if (pRes.status === 'fulfilled') setPeople(pRes.value?.data || pRes.value);
      if (cRes.status === 'fulfilled') setContracts(cRes.value?.data || cRes.value);
      if (toRes.status === 'fulfilled') setTimeOff(toRes.value?.data || toRes.value);
      if (oRes.status === 'fulfilled') setOrg(oRes.value?.data || oRes.value);

      lastFetch.current = Date.now();
    } catch (err) {
      console.warn('[useDeelData] Failed:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    people, contracts, timeOff, org,
    loading, error, refresh,
    isAvailable: !!(people || contracts),
  };
}

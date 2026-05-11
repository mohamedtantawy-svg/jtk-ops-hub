// ── useMyActiveCoverages ──────────────────────────────────────────────
// Returns the list of handovers the caller is actively covering today
// (status=approved or active, accepted coverage, today in window).
// Auto-refreshes every 2 minutes so a state change on the server
// (cron tick, another user submits a handover for me, lifecycle flip)
// shows up without a manual reload.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMyActiveCoverages } from '../services/handoversApi';

const REFRESH_MS = 2 * 60 * 1000;

export function useMyActiveCoverages({ enabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const res = await fetchMyActiveCoverages();
      if (reqIdRef.current !== reqId) return;
      setItems(res?.items || []);
      setError(null);
    } catch (err) {
      if (reqIdRef.current !== reqId) return;
      setError(err);
      // eslint-disable-next-line no-console
      console.warn('[useMyActiveCoverages] fetch failed:', err?.message);
    } finally {
      if (reqIdRef.current === reqId) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  return { items, loading, error, refresh };
}

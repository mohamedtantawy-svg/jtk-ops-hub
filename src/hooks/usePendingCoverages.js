// ── usePendingCoverages ───────────────────────────────────────────────
// Returns the caller's coverage invitations awaiting a response (handovers
// in pending_coverage_acceptance where the caller is a still-pending
// coverer). Powers the home-page PendingCoverageBanner + the accept/decline
// popup + the App-level auto-prompt. Mirrors useMyActiveCoverages.
//
// Auto-refreshes every 2 minutes AND on the `ooo:coverageResponded` window
// event so that accepting / declining anywhere (the popup, the OOO view)
// clears the invitation from every banner instance immediately instead of
// waiting out the poll.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMyPendingCoverages } from '../services/handoversApi';

const REFRESH_MS = 2 * 60 * 1000;

export function usePendingCoverages({ enabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const res = await fetchMyPendingCoverages();
      if (reqIdRef.current !== reqId) return;
      setItems(res?.items || []);
      setError(null);
    } catch (err) {
      if (reqIdRef.current !== reqId) return;
      setError(err);
      // eslint-disable-next-line no-console
      console.warn('[usePendingCoverages] fetch failed:', err?.message);
    } finally {
      if (reqIdRef.current === reqId) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(refresh, REFRESH_MS);
    const onResponded = () => refresh();
    window.addEventListener('ooo:coverageResponded', onResponded);
    return () => {
      clearInterval(id);
      window.removeEventListener('ooo:coverageResponded', onResponded);
    };
  }, [enabled, refresh]);

  return { items, loading, error, refresh };
}

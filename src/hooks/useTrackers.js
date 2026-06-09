// ── useTrackers ────────────────────────────────────────────────────────────
// Lists the spreadsheet trackers (generic tracker engine) for the Tracker tab's
// sub-tab nav. Managers-only on the server — a 403 (agent) is treated as "no
// trackers" so agents simply see no grid sub-tabs (the board sub-tabs still
// render). Light: returns tracker meta + columnSchema + rowCount, not rows.
import { useState, useEffect, useCallback, useRef } from 'react';
import { listTrackers, createTracker as createTrackerApi } from '../services/trackerApi';

export function useTrackers(enabled = true) {
  const [trackers, setTrackers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(null);

  const refresh = useCallback(() => {
    if (!enabled) return null;
    if (inFlightRef.current) return inFlightRef.current;
    setLoading(true);
    const run = (async () => {
      try {
        const res = await listTrackers();
        setTrackers(Array.isArray(res?.trackers) ? res.trackers : []);
        setError(null);
      } catch (err) {
        // 403 = not a manager → no trackers (expected; not surfaced as an error).
        if (err?.status === 403) { setTrackers([]); setError(null); }
        else { setError(err?.message || 'Failed to load trackers'); }
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  const createTracker = useCallback(async (payload) => {
    const res = await createTrackerApi(payload);
    refresh();
    return res?.tracker || null;
  }, [refresh]);

  return { trackers, loading, error, refresh, createTracker };
}

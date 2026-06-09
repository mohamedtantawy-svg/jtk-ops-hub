// ── usePerfReviews ──────────────────────────────────────────────────────────
// Loads Performance reviews for a scope/period (Phase C). Mirrors the
// usePerfTemplates SWR-ish shape: loads on mount + whenever the params change,
// dedupes in-flight requests, and refreshes after a write (upsert/patch) so the
// derived scores the server recomputes are reflected. Server enforces access —
// agents only ever see scope 'mine'; a 403 (e.g. a non-manager asking for
// 'team') resolves to an empty result with no error so the UI degrades quietly.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listPerfReviews, upsertPerfReview, patchPerfReview,
} from '../services/performanceApi';

export function usePerfReviews({ scope = 'mine', month, year, member, enabled = true } = {}) {
  const [reviews, setReviews] = useState([]);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Monotonic sequence guard (à la useHrHubBadge): a newer refresh supersedes
  // an older in-flight one, so rapid param changes (e.g. flipping month then
  // year) never leave the UI showing a stale period's data.
  const seqRef = useRef(0);
  // Snapshot of the current params so refresh() (a stable callback) always
  // fetches with the latest values without being re-created on every change.
  const paramsRef = useRef({ scope, month, year, member });
  paramsRef.current = { scope, month, year, member };

  const refresh = useCallback(() => {
    if (!enabled) return null;
    const myseq = ++seqRef.current;
    setLoading(true);
    return (async () => {
      try {
        const res = await listPerfReviews(paramsRef.current);
        if (myseq !== seqRef.current) return;   // superseded by a newer refresh
        setReviews(Array.isArray(res?.reviews) ? res.reviews : []);
        setRoster(Array.isArray(res?.roster) ? res.roster : []);
        setError(null);
      } catch (err) {
        if (myseq !== seqRef.current) return;
        if (err?.status === 403) { setReviews([]); setRoster([]); setError(null); }
        else setError(err?.message || 'Failed to load reviews');
      } finally {
        if (myseq === seqRef.current) setLoading(false);
      }
    })();
  }, [enabled]);

  // Reload on mount and whenever the query params change.
  useEffect(() => {
    if (!enabled) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope, month, year, member, refresh]);

  const upsert = useCallback(async (payload) => {
    const res = await upsertPerfReview(payload);
    refresh();
    return res?.review || null;
  }, [refresh]);

  const patch = useCallback(async (id, p) => {
    const res = await patchPerfReview(id, p);
    refresh();
    return res?.review || null;
  }, [refresh]);

  return { reviews, roster, loading, error, refresh, upsert, patch };
}

// ── useCountryOverlay ───────────────────────────────────────────────────────
// Fix #3 (Sarah Suge — "Managers Task View Should Be Based on Countries").
//
// When the Queue's Country filter is active, this fetches EVERY task in those
// countries — including rows outside the viewer's normal visibility — from
// /api/v1/queue/country-overlay (which reads the warm server caches unscoped).
// Queue.jsx merges the result into each source panel, so the existing scoped
// data path is left completely untouched: the hook is inert (returns {}) when
// no country is selected, and only layers extra rows on top when one is.
//
// Best-effort + supplementary: any error degrades to an empty overlay (the
// base queue is unaffected), and a 60s poll keeps it roughly fresh while a
// country stays selected. Not cached in localStorage — it's a transient view.
import { useEffect, useState } from 'react';
import { apiFetch } from '../services/api';

const EMPTY = Object.freeze({});

export function useCountryOverlay(countries, { enabled = true } = {}) {
  // Stable, order-independent key so re-renders with the same set don't refetch.
  const key = Array.isArray(countries) && countries.length
    ? [...new Set(countries.map(c => String(c).toUpperCase()))].sort().join(',')
    : '';
  const [bySource, setBySource] = useState(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !key) { setBySource(EMPTY); setLoading(false); return; }
    let cancelled = false;
    const abort = new AbortController();
    const run = () => {
      setLoading(true);
      apiFetch(`/queue/country-overlay?countries=${encodeURIComponent(key)}`, { signal: abort.signal })
        .then(res => { if (!cancelled) { setBySource(res?.bySource || EMPTY); setLoading(false); } })
        .catch(err => { if (!cancelled && err?.name !== 'AbortError') setLoading(false); });
    };
    run();
    const id = setInterval(run, 60_000);
    return () => { cancelled = true; abort.abort(); clearInterval(id); };
  }, [key, enabled]);

  return { bySource, loading };
}

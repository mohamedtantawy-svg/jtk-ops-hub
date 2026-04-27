// ── useTicketFieldsMeta ─────────────────────────────────────────────────────
// Loads the metadata for the 4 ops-hub-tracked Zendesk custom fields
// (employeeCountry / form / rootCauseSupport / rootCauseSelector) once per
// session and shares the result across every Detail page mount.
//
// The backend already caches the discovery for an hour server-side, so the
// FE just needs a small in-memory hold-and-share so we don't fire a fetch
// every time the user opens a different ticket. Falls back gracefully when
// Zendesk is unconfigured: returns a shape with all-null entries and the
// Detail page renders read-only placeholder rows.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { fetchZendeskTicketFields } from '../services/integrationsApi';

const TTL_MS = 60 * 60 * 1000; // 1h — same as backend cache
let cache = { value: null, ts: 0, inflight: null };

async function loadOnce({ force = false } = {}) {
  if (!force && cache.value && (Date.now() - cache.ts) < TTL_MS) return cache.value;
  if (cache.inflight) return cache.inflight;
  cache.inflight = (async () => {
    try {
      const res = await fetchZendeskTicketFields(force ? { force: true } : {});
      const fields = res?.fields || null;
      cache = { value: fields, ts: Date.now(), inflight: null };
      return fields;
    } catch (err) {
      cache.inflight = null;
      throw err;
    }
  })();
  return cache.inflight;
}

export function useTicketFieldsMeta() {
  const [meta, setMeta] = useState(cache.value);
  const [loading, setLoading] = useState(!cache.value);
  const [error, setError] = useState(null);

  const refresh = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const v = await loadOnce({ force });
      setMeta(v);
      return v;
    } catch (err) {
      setError(err?.message || 'Failed to load ticket fields');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cache.value) {
      setMeta(cache.value);
      setLoading(false);
      return;
    }
    let cancelled = false;
    loadOnce()
      .then(v => { if (!cancelled) { setMeta(v); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err?.message || 'Failed to load ticket fields'); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return { meta, loading, error, refresh };
}

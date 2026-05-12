'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Hook: fetches and caches the workspace queue via the role-scoped API.
// Auto-refreshes on a 60s interval (matches HR's queue cadence) and on
// window focus so tab switches surface stale data quickly.
//
// Returns { items, meta, loading, error, refresh } — items is the
// normalised ticket list, meta carries role + group + truncation + cachedAt.

const REFRESH_INTERVAL_MS = 60_000;

function authHeaders() {
  const h = {};
  try {
    const t = localStorage.getItem('ops_hub_token');
    if (t) h.Authorization = `Bearer ${t}`;
  } catch {}
  return h;
}

export default function useWorkspaceQueue(workspaceId, { enabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!workspaceId || !enabled) return;
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/queue`,
        { credentials: 'same-origin', headers: authHeaders() },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || body?.meta?.error || `HTTP ${res.status}`);
      }
      setItems(Array.isArray(body.items) ? body.items : []);
      setMeta(body.meta || null);
    } catch (err) {
      setError(err);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [workspaceId, enabled]);

  // Initial + interval refresh
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = setInterval(() => refresh({ silent: true }), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh, enabled]);

  // Refresh on focus
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => refresh({ silent: true });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh, enabled]);

  return { items, meta, loading, error, refresh };
}

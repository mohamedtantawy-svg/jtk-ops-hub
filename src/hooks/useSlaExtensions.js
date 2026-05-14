// ── useSlaExtensions — global active-extension list ─────────────────────
// SWR-style hook that mirrors useHiddenTasks. Fetches
// /api/v1/sla-extension/list every 30s while visible, hydrates from a
// localStorage cache for instant paint, and exposes a `Map<key, ext>`
// the queue normalizers consume via applySlaExtensionsToRows.
//
// Cache + broadcast are intentionally NOT user-scoped here: the active-
// extension list is global metadata. Two users on the same machine
// looking at different queues both see the same set of overrides — no
// data leakage because the user's own row-scoping still filters which
// rows they can see in the first place.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listSlaExtensions } from '../services/slaExtensionApi';
import { buildExtensionMap } from '../utils/applySlaExtensions';

const CACHE_KEY = 'ops_hub_sla_extensions_cache';
const CACHE_TTL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 30 * 1000;
const CHANNEL_NAME = 'ops_hub_sla_extensions_sync';

function readCache() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (parsed.ts && Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(items) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items, ts: Date.now() })); }
  catch {}
}

let _channel = null;
let _channelFailed = false;
function getChannel() {
  if (_channel || _channelFailed) return _channel;
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    _channelFailed = true;
    return null;
  }
  try { _channel = new BroadcastChannel(CHANNEL_NAME); return _channel; }
  catch { _channelFailed = true; return null; }
}

export function useSlaExtensions(enabled = true) {
  const cached = readCache();
  const [items, setItems] = useState(() => cached?.items || []);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState(null);

  const inFlightRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    if (inFlightRef.current) return inFlightRef.current;
    const run = (async () => {
      try {
        const res = await listSlaExtensions();
        if (!mountedRef.current) return null;
        const nextItems = Array.isArray(res?.items) ? res.items : [];
        setItems(nextItems);
        setError(null);
        writeCache(nextItems);
        const ch = getChannel();
        if (ch) { try { ch.postMessage({ items: nextItems, ts: Date.now() }); } catch {} }
        return nextItems;
      } catch (err) {
        if (!mountedRef.current) return null;
        setError(err);
        return null;
      } finally {
        if (mountedRef.current) setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    let interval = null;
    if (typeof document !== 'undefined') {
      interval = setInterval(() => { if (!document.hidden) refresh(); }, POLL_INTERVAL_MS);
      const onVis = () => { if (!document.hidden) refresh(); };
      const onFocus = () => refresh();
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('focus', onFocus);
      return () => {
        if (interval) clearInterval(interval);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('focus', onFocus);
      };
    }
    return () => { if (interval) clearInterval(interval); };
  }, [enabled, refresh]);

  useEffect(() => {
    const ch = getChannel();
    if (!ch) return;
    const handler = (e) => {
      if (!e?.data || !Array.isArray(e.data.items)) return;
      setItems(e.data.items);
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, []);

  // Memo the Map so referential equality lets downstream consumers skip
  // re-applying the override unless the list actually changed.
  const map = useMemo(() => buildExtensionMap(items), [items]);

  return useMemo(() => ({
    items,
    map,
    loading,
    error,
    refresh: () => refresh(),
  }), [items, map, loading, error, refresh]);
}

// ── useHiddenTasks ────────────────────────────────────────────────────────
// Thin hook that fetches the global hide list from /api/v1/hide-task/list
// and exposes:
//   • items[]               — full hidden_task rows (for admin views)
//   • hiddenKeys: Set<string> — `${source}:${id}` membership for fast O(1)
//                              lookups in queue render paths
//   • isHidden(source, id)  — convenience wrapper around hiddenKeys.has()
//   • refresh()             — manual re-fetch (used after Approve/Deny so
//                              the queue updates without a full reload)
//   • loading / error
//
// Pre-warmed at the App.jsx auth boundary (alongside useQueueUnifiedSync)
// so by the time the user clicks Queue the hide list is already in memory.
// Cross-tab BroadcastChannel adoption mirrors the queue hooks — when one
// tab sees a fresh list, every other tab adopts it without re-hitting the
// network.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listHiddenTasks } from '../services/hideTaskApi';

const TICK_MS = 30_000;
const CHANNEL_NAME = 'ops_hub_hidden_tasks_sync';

let _channel = null;
let _channelFailed = false;
function getChannel() {
  if (_channel) return _channel;
  if (_channelFailed) return null;
  if (typeof BroadcastChannel === 'undefined') { _channelFailed = true; return null; }
  try { _channel = new BroadcastChannel(CHANNEL_NAME); return _channel; }
  catch { _channelFailed = true; return null; }
}

export function useHiddenTasks(enabled = true) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const seqRef = useRef(0);
  const inFlightRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    if (inFlightRef.current) return inFlightRef.current;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    const run = (async () => {
      try {
        const res = await listHiddenTasks();
        if (seq !== seqRef.current) return null;
        const next = Array.isArray(res?.items) ? res.items : [];
        setItems(next);
        setLastSyncAt(Date.now());
        // Best-effort cross-tab broadcast.
        const ch = getChannel();
        try { ch?.postMessage({ items: next, ts: Date.now() }); } catch {}
        return next;
      } catch (err) {
        if (seq !== seqRef.current) return null;
        // Preserve previous list on transient error — same pattern as the
        // urgent-assist hook hardening. Surfaces the message in `error`
        // so the UI can show a non-destructive banner.
        setError(err?.message || 'Could not load hidden tasks');
        return null;
      } finally {
        if (seq === seqRef.current) setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [enabled]);

  // Initial fetch + visibility-aware polling. We don't poll on a tight
  // cadence — the hide list moves slowly; 30s + manual refresh on
  // approve/deny actions covers the operating tempo.
  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    let id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refresh();
    }, TICK_MS);
    const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) refresh(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      if (id) clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, refresh]);

  // Cross-tab: adopt newer payloads from sibling tabs without re-fetching.
  useEffect(() => {
    if (!enabled) return undefined;
    const ch = getChannel();
    if (!ch) return undefined;
    const onMsg = (e) => {
      const msg = e.data;
      if (!msg || !Array.isArray(msg.items)) return;
      if (msg.ts && (!lastSyncAt || msg.ts > lastSyncAt)) {
        setItems(msg.items);
        setLastSyncAt(msg.ts);
      }
    };
    ch.addEventListener('message', onMsg);
    return () => ch.removeEventListener('message', onMsg);
  }, [enabled, lastSyncAt]);

  const hiddenKeys = useMemo(() => {
    const set = new Set();
    for (const it of items) {
      if (it?.taskSource && it?.taskId) {
        set.add(`${String(it.taskSource).toLowerCase()}:${String(it.taskId)}`);
      }
    }
    return set;
  }, [items]);

  const isHidden = useCallback((source, id) => {
    if (!source || !id) return false;
    return hiddenKeys.has(`${String(source).toLowerCase()}:${String(id)}`);
  }, [hiddenKeys]);

  return { items, hiddenKeys, isHidden, loading, error, lastSyncAt, refresh };
}

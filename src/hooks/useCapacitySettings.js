// ── useCapacitySettings ───────────────────────────────────────────────────
// Hook that exposes the team-tunable capacity thresholds (lowMax / highMin)
// to any consumer. Loaded once on mount, cached in localStorage so the next
// mount paints with the right values instantly, and reloaded in the
// background whenever the Team-tab capacity table writes new values
// (via a BroadcastChannel ping). Falls back to the route's defaults if
// the fetch fails so the home health score / Team workload bands always
// have something sensible to compute against.

import { useState, useEffect, useRef } from 'react';
import { fetchCapacitySettings } from '../services/capacityApi';

const LS_KEY = 'ops_hub_queue_capacity_v1';
const CHANNEL_NAME = 'ops_hub_queue_capacity_sync';

// Mirrors DEFAULT_CAPACITY in app/api/v1/settings/capacity/route.js. Keeping
// a copy here so the hook can paint instantly even before the first fetch
// resolves; the route's response always overrides this once it lands.
const DEFAULT_CAPACITY = { lowMax: 40, highMin: 100 };

function readFromLs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeToLs(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

let _channel = null;
let _channelFailed = false;
function getChannel() {
  if (_channel) return _channel;
  if (_channelFailed) return null;
  if (typeof BroadcastChannel === 'undefined') { _channelFailed = true; return null; }
  try { _channel = new BroadcastChannel(CHANNEL_NAME); return _channel; }
  catch { _channelFailed = true; return null; }
}

export function broadcastCapacityUpdate(payload) {
  const ch = getChannel();
  if (!ch) return;
  try { ch.postMessage(payload); } catch {}
}

export function useCapacitySettings() {
  // Sync-paint from LS so the workload bands don't flicker through the
  // 30s defaults on the first render of Briefing / Team.
  const [data, setData] = useState(() => readFromLs() || { capacity: DEFAULT_CAPACITY, updatedBy: null, updatedAt: null });
  const [isLoading, setIsLoading] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    let abort = new AbortController();
    setIsLoading(true);
    fetchCapacitySettings({ signal: abort.signal })
      .then(res => {
        if (cancelledRef.current) return;
        if (res && res.capacity) {
          setData(res);
          writeToLs(res);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
    return () => { cancelledRef.current = true; abort.abort(); };
  }, []);

  useEffect(() => {
    const ch = getChannel();
    if (!ch) return;
    const onMsg = (e) => {
      const msg = e.data;
      if (msg && msg.capacity) { setData(msg); writeToLs(msg); }
    };
    ch.addEventListener('message', onMsg);
    return () => ch.removeEventListener('message', onMsg);
  }, []);

  return {
    capacity: data?.capacity || DEFAULT_CAPACITY,
    updatedBy: data?.updatedBy || null,
    updatedAt: data?.updatedAt || null,
    isLoading,
  };
}

export { DEFAULT_CAPACITY };

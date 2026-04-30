// ── useQueueSlaSettings ────────────────────────────────────────────────────
// Hook that exposes the team-tunable SLA thresholds (in minutes) to any
// consumer that needs them. Loaded once on mount, cached in localStorage so
// the next mount paints with the right values instantly, and reloaded in
// the background whenever the Team-tab settings table writes new values
// (via a BroadcastChannel ping). Falls back to the defaults baked into the
// queue-sla route if the fetch fails so SLA pills never go blank.

import { useState, useEffect, useRef } from 'react';
import { fetchQueueSlaSettings } from '../services/queueSlaSettingsApi';

const LS_KEY = 'ops_hub_queue_sla_v1';
const CHANNEL_NAME = 'ops_hub_queue_sla_sync';

// Mirrors the DEFAULT_SLA in app/api/v1/settings/queue-sla/route.js. Keeping
// a copy here so the hook can paint instantly even before the first fetch
// resolves; the route's response always overrides this once it lands.
// All values are BUSINESS-DAY minutes (Sat/Sun excluded) per the 2026-05-01
// spec. Offboarding splits by row type so Termination (14d) and Resignation
// (5d) can be tuned independently.
const DEFAULT_SLA = {
  zendesk:                 { activeMins: 1440,  pausedMins: 2880 },
  jira:                    { activeMins: 2880 },
  workbench:               { activeMins: 2880,  pausedMins: 2880 },
  amendments:              { activeMins: 1440,  pausedMins: 2880 },
  redlines:                { activeMins: 7200,  pausedMins: 2880 },
  onboarding:              { activeMins: 1440,  pausedMins: 2880 },
  offboarding_termination: { activeMins: 20160, pausedMins: 2880 },
  offboarding_resignation: { activeMins: 7200,  pausedMins: 2880 },
};

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

export function broadcastQueueSlaUpdate(payload) {
  const ch = getChannel();
  if (!ch) return;
  try { ch.postMessage(payload); } catch {}
}

export function useQueueSlaSettings() {
  // Sync-paint from LS so the SLA pills don't flash with stale defaults.
  const [data, setData] = useState(() => readFromLs() || { sla: DEFAULT_SLA, updatedBy: null, updatedAt: null });
  const [isLoading, setIsLoading] = useState(false);
  const cancelledRef = useRef(false);

  // Fetch once on mount.
  useEffect(() => {
    let abort = new AbortController();
    setIsLoading(true);
    fetchQueueSlaSettings({ signal: abort.signal })
      .then(res => {
        if (cancelledRef.current) return;
        if (res && res.sla) {
          setData(res);
          writeToLs(res);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
    return () => { cancelledRef.current = true; abort.abort(); };
  }, []);

  // Adopt cross-tab pings from the settings page.
  useEffect(() => {
    const ch = getChannel();
    if (!ch) return;
    const onMsg = (e) => {
      const msg = e.data;
      if (msg && msg.sla) { setData(msg); writeToLs(msg); }
    };
    ch.addEventListener('message', onMsg);
    return () => ch.removeEventListener('message', onMsg);
  }, []);

  return { sla: data?.sla || DEFAULT_SLA, updatedBy: data?.updatedBy || null, updatedAt: data?.updatedAt || null, isLoading };
}

// Re-export for normalizers that don't have access to React state (rare).
export { DEFAULT_SLA };

// ── useSlackData hook ────────────────────────────────────────────────────────
// Fetches Slack channel data for escalations and HR ops channels.
// Caches in localStorage. Staggered load to avoid mount stampede.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchSlackChannels, fetchSlackChannelHistory, sendSlackMessage,
} from '../services/integrationsApi';

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const CACHE_KEY = 'ops_hub_slack_data';
const LOAD_DELAY = 3000; // lowest priority — load last

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL) return parsed;
    }
  } catch (e) { console.warn('[useSlackData] Cache read failed:', e.message); }
  return null;
}

export function useSlackData(enabled = true) {
  const cached = readCache();
  const [channels, setChannels] = useState(cached?.channels || null);
  const [escalationMessages, setEscalationMessages] = useState(cached?.escalationMessages || null);
  const [hrOpsMessages, setHrOpsMessages] = useState(cached?.hrOpsMessages || null);
  const [loading, setLoading] = useState(!cached && enabled);
  const [error, setError] = useState(null);
  const lastFetch = useRef(cached ? cached.ts : 0);

  const [escalationChannelId, setEscalationChannelId] = useState(cached?.escalationChannelId || null);
  const [hrOpsChannelId, setHrOpsChannelId] = useState(cached?.hrOpsChannelId || null);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force && Date.now() - lastFetch.current < CACHE_TTL) return;

    setLoading(true);
    setError(null);
    try {
      const chanRes = await fetchSlackChannels();
      const chanList = chanRes?.channels || [];
      setChannels(chanList);

      const escChan = chanList.find(c => c.name === 'escalations' || c.name === 'hr-escalations');
      const hrOpsChan = chanList.find(c => c.name === 'hr-ops' || c.name === 'hrop-ops');

      let escMsgs = escalationMessages;
      let hrMsgs = hrOpsMessages;

      if (escChan) {
        setEscalationChannelId(escChan.id);
        try {
          const hist = await fetchSlackChannelHistory(escChan.id, { limit: 30 });
          escMsgs = hist?.messages || [];
          setEscalationMessages(escMsgs);
        } catch (e) { console.warn('[useSlackData] Escalation channel history fetch failed:', e.message); }
      }

      if (hrOpsChan) {
        setHrOpsChannelId(hrOpsChan.id);
        try {
          const hist = await fetchSlackChannelHistory(hrOpsChan.id, { limit: 30 });
          hrMsgs = hist?.messages || [];
          setHrOpsMessages(hrMsgs);
        } catch (e) { console.warn('[useSlackData] HR ops channel history fetch failed:', e.message); }
      }

      lastFetch.current = Date.now();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          channels: chanList,
          escalationMessages: escMsgs,
          hrOpsMessages: hrMsgs,
          escalationChannelId: escChan?.id || null,
          hrOpsChannelId: hrOpsChan?.id || null,
          ts: Date.now(),
        }));
      } catch (e) { console.warn('[useSlackData] Cache write failed:', e.message); }
    } catch (err) {
      console.warn('[useSlackData] Failed:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    if (lastFetch.current > 0 && Date.now() - lastFetch.current < CACHE_TTL) return;
    const timer = setTimeout(() => refresh(), LOAD_DELAY);
    return () => clearTimeout(timer);
  }, [refresh, enabled]);

  const sendMessage = useCallback(async (channelId, text, opts = {}) => {
    try {
      const res = await sendSlackMessage(channelId, text, opts);
      setTimeout(() => refresh(true), 500);
      return res;
    } catch (err) {
      console.error('[useSlackData] Send failed:', err.message);
      throw err;
    }
  }, [refresh]);

  const fetchHistory = useCallback(async (channelId, opts = {}) => {
    try {
      const res = await fetchSlackChannelHistory(channelId, opts);
      return res?.messages || [];
    } catch (e) {
      console.warn('[useSlackData] Fetch history failed:', e.message);
      return [];
    }
  }, []);

  return {
    channels, escalationMessages, hrOpsMessages,
    escalationChannelId, hrOpsChannelId,
    loading, error, refresh: () => refresh(true),
    sendMessage, fetchHistory,
    isAvailable: !!channels,
  };
}

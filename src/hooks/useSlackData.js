// ── useSlackData hook ────────────────────────────────────────────────────────
// Fetches Slack channel data for escalations and HR ops channels.
// Falls back gracefully if the integration is not configured.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchSlackChannels, fetchSlackChannelHistory, sendSlackMessage,
} from '../services/integrationsApi';

const CACHE_TTL = 60 * 1000; // 1 minute (Slack messages are more real-time)

export function useSlackData(enabled = true) {
  const [channels, setChannels] = useState(null);
  const [escalationMessages, setEscalationMessages] = useState(null);
  const [hrOpsMessages, setHrOpsMessages] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetch = useRef(0);

  // Channel IDs — configured via env vars, or discovered from channel list
  const [escalationChannelId, setEscalationChannelId] = useState(null);
  const [hrOpsChannelId, setHrOpsChannelId] = useState(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (Date.now() - lastFetch.current < CACHE_TTL) return;

    setLoading(true);
    setError(null);
    try {
      const chanRes = await fetchSlackChannels();
      const chanList = chanRes?.channels || [];
      setChannels(chanList);

      // Auto-discover well-known channels
      const escChan = chanList.find(c => c.name === 'escalations' || c.name === 'hr-escalations');
      const hrOpsChan = chanList.find(c => c.name === 'hr-ops' || c.name === 'hrop-ops');

      if (escChan) {
        setEscalationChannelId(escChan.id);
        try {
          const hist = await fetchSlackChannelHistory(escChan.id, { limit: 30 });
          setEscalationMessages(hist?.messages || []);
        } catch {}
      }

      if (hrOpsChan) {
        setHrOpsChannelId(hrOpsChan.id);
        try {
          const hist = await fetchSlackChannelHistory(hrOpsChan.id, { limit: 30 });
          setHrOpsMessages(hist?.messages || []);
        } catch {}
      }

      lastFetch.current = Date.now();
    } catch (err) {
      console.warn('[useSlackData] Failed:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  const sendMessage = useCallback(async (channelId, text, opts = {}) => {
    try {
      const res = await sendSlackMessage(channelId, text, opts);
      // Refresh messages after sending
      setTimeout(refresh, 500);
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
    } catch {
      return [];
    }
  }, []);

  return {
    channels, escalationMessages, hrOpsMessages,
    escalationChannelId, hrOpsChannelId,
    loading, error, refresh,
    sendMessage, fetchHistory,
    isAvailable: !!channels,
  };
}

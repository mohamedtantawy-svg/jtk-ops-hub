// ── useSlackData hook ────────────────────────────────────────────────────────
// Fetches Slack channel data for escalations and HR ops channels.
// Caches in IndexedDB (was localStorage; moved to dodge the 5–10 MB shared
// cap — channel histories can run several MB on busy channels).
// Staggered load to avoid mount stampede.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchSlackChannels, fetchSlackChannelHistory, sendSlackMessage,
} from '../services/integrationsApi';
import { idbGetWithMigration, idbSet } from '../lib/idb-cache';

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const CACHE_KEY = 'ops_hub_slack_data';
const LOAD_DELAY = 3000; // lowest priority — load last

export function useSlackData(enabled = true) {
  // IDB cache is async; initial state is empty and the hydration effect
  // below fills it ~10–50 ms after mount. liveReceivedRef gates the
  // hydration so a late IDB read can't clobber fresh network data.
  const [channels, setChannels] = useState(null);
  const [escalationMessages, setEscalationMessages] = useState(null);
  const [hrOpsMessages, setHrOpsMessages] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const lastFetch = useRef(0);
  const liveReceivedRef = useRef(false);

  const [escalationChannelId, setEscalationChannelId] = useState(null);
  const [hrOpsChannelId, setHrOpsChannelId] = useState(null);

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
      liveReceivedRef.current = true;
      // Fire-and-forget IDB write — never blocks UI; failures log via the
      // helper and the next refresh re-tries naturally.
      idbSet(CACHE_KEY, {
        channels: chanList,
        escalationMessages: escMsgs,
        hrOpsMessages: hrMsgs,
        escalationChannelId: escChan?.id || null,
        hrOpsChannelId: hrOpsChan?.id || null,
        ts: Date.now(),
      }).catch(() => {});
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

  // ── IDB cache hydration ───────────────────────────────────────────────────
  // Async fill from IDB after mount, with one-shot legacy localStorage
  // migration. Skipped if the live fetch already returned.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await idbGetWithMigration(CACHE_KEY);
      if (cancelled) return;
      if (liveReceivedRef.current) return;
      if (!cached?.ts || Date.now() - cached.ts >= CACHE_TTL) return;
      setChannels(cached.channels || null);
      setEscalationMessages(cached.escalationMessages || null);
      setHrOpsMessages(cached.hrOpsMessages || null);
      setEscalationChannelId(cached.escalationChannelId || null);
      setHrOpsChannelId(cached.hrOpsChannelId || null);
      lastFetch.current = cached.ts;
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

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

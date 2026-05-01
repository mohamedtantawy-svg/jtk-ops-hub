// ── usePausedOnboardingData hook ────────────────────────────────────────────
// Fetches paused onboarding contracts from the Deel Admin API.
// Same pattern as useOnboardingData but for Onboarding.EA.EASigning.Paused.
// Auto-refreshes while visible and user-scopes the cache so signed-in users
// never inherit each other's payload.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDeelOnboardingPaused } from '../services/integrationsApi';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';
import { idbGetWithMigration, idbSet } from '../lib/idb-cache';

const SOURCE_ID = 'pausedOnboarding';
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY_BASE = 'ops_hub_onboarding_paused_cache';
const cacheKeyFor = (userEmail) =>
  userEmail ? `${CACHE_KEY_BASE}:${String(userEmail).toLowerCase()}` : CACHE_KEY_BASE;

export function usePausedOnboardingData(enabled = true, userEmail = null) {
  // IDB cache (was localStorage). Empty initial state; hydration effect
  // below fills it ~10–50 ms after mount, gated by liveReceivedRef so a
  // late-arriving cached payload can't overwrite fresher network data.
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(null);
  const liveReceivedRef = useRef(false);
  // Mirror items via ref so refresh() can read the current count without
  // listing items.length in its deps. See useOnboardingData for the
  // detailed rationale.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return null;
    if (!force && Date.now() - lastFetchRef.current < CACHE_TTL) return null;
    if (!force && inFlightRef.current) return inFlightRef.current;

    setIsRefreshing(true);
    setLoading(prev => itemsRef.current.length === 0 ? true : prev);
    setError(null);

    const run = (async () => {
      try {
        const res = await fetchDeelOnboardingPaused();
        const fetched = res?.items || [];
        const now = Date.now();
        if (fetched.length > 0 || itemsRef.current.length === 0) {
          setItems(fetched);
          idbSet(cacheKeyFor(userEmail), { items: fetched, ts: now }).catch(() => {});
          broadcastSync(SOURCE_ID, fetched, null, userEmail);
        }
        lastFetchRef.current = now;
        liveReceivedRef.current = true;
        setLastSyncAt(now);
        return fetched;
      } catch (err) {
        console.warn('[usePausedOnboardingData] Failed:', err.message);
        setError(err.message);
        return null;
      } finally {
        setLoading(false);
        setIsRefreshing(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [enabled, userEmail]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── IDB cache hydration ───────────────────────────────────────────────────
  // Async fill from IDB after mount, with one-shot legacy localStorage
  // migration. Skipped if the live fetch already returned.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await idbGetWithMigration(cacheKeyFor(userEmail));
      if (cancelled) return;
      if (liveReceivedRef.current) return;
      if (!cached?.items?.length) return;
      setItems(cached.items);
      lastFetchRef.current = cached.ts || 0;
      setLastSyncAt(cached.ts || null);
    })();
    return () => { cancelled = true; };
  }, [userEmail]);

  // Auto-refresh while visible (mirrors useOnboardingData) so the card doesn't
  // pin to its first mount timestamp and trip the "stale" banner.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refresh();
    };
    const id = setInterval(tick, CACHE_TTL);
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) refresh();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    const ch = getQueueChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg || msg.source !== SOURCE_ID) return;
      const myKey = (userEmail || '').toLowerCase();
      const theirKey = (msg.userKey || '').toLowerCase();
      // Tighter than the previous `myKey && theirKey && ...` — that
      // accepted a scoped message from another user when our own email
      // hadn't loaded yet (logged-out tab, hydration race). Reject
      // whenever EITHER side has a key that doesn't match the other.
      if ((myKey || theirKey) && myKey !== theirKey) return;
      if (msg.ts && msg.ts > lastFetchRef.current) {
        setItems(msg.items || []);
        lastFetchRef.current = msg.ts;
        setLastSyncAt(msg.ts);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, [userEmail]);

  return {
    items,
    loading,
    isRefreshing,
    error,
    lastSyncAt,
    refresh: () => refresh(true),
    isAvailable: items.length > 0 || !error,
  };
}

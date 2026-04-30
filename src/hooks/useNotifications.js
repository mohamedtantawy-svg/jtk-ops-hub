// ── useNotifications — server-persisted notification feed ───────────────────
// Polls /api/v1/notifications, exposes the list + unread count + mutation
// helpers. SWR-style: hydrates from localStorage cache for instant paint,
// then revalidates over the wire. Cache + cross-tab broadcast are
// user-scoped so two signed-in users on the same machine never see each
// other's notifications.
// ──────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/notificationsApi';

const CACHE_KEY_BASE = 'ops_hub_notifications_cache';
const CACHE_TTL_MS = 5 * 60 * 1000;     // 5min cache window for stale-while-revalidate
const POLL_INTERVAL_MS = 30 * 1000;     // refetch every 30s while visible
const CHANNEL_NAME = 'ops_hub_notifications_sync';

function cacheKeyFor(userEmail) {
  const lc = (userEmail || '').toLowerCase();
  return lc ? `${CACHE_KEY_BASE}:${lc}` : CACHE_KEY_BASE;
}

function readCache(userEmail) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKeyFor(userEmail));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (parsed.ts && Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(userEmail, items, unreadCount) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      cacheKeyFor(userEmail),
      JSON.stringify({ items, unreadCount, ts: Date.now() }),
    );
  } catch {}
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

export function useNotifications(userEmail) {
  const cached = readCache(userEmail);
  const [items, setItems] = useState(() => cached?.items || []);
  const [unreadCount, setUnreadCount] = useState(() => cached?.unreadCount ?? 0);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState(null);

  const inFlightRef = useRef(null);
  const mountedRef = useRef(true);
  const userEmailRef = useRef(userEmail);
  useEffect(() => { userEmailRef.current = userEmail; }, [userEmail]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Re-hydrate from cache when the user changes (impersonation / login swap).
  useEffect(() => {
    const c = readCache(userEmail);
    if (c) {
      setItems(c.items);
      setUnreadCount(c.unreadCount ?? 0);
      setLoading(false);
    } else {
      setItems([]);
      setUnreadCount(0);
      setLoading(true);
    }
  }, [userEmail]);

  const refresh = useCallback(async () => {
    if (!userEmailRef.current) return null;
    if (inFlightRef.current) return inFlightRef.current;
    const run = (async () => {
      try {
        const res = await listNotifications({ limit: 50 });
        if (!mountedRef.current) return null;
        const nextItems = Array.isArray(res?.items) ? res.items : [];
        const nextUnread = Number.isFinite(res?.unreadCount) ? res.unreadCount : 0;
        setItems(nextItems);
        setUnreadCount(nextUnread);
        setError(null);
        writeCache(userEmailRef.current, nextItems, nextUnread);
        const ch = getChannel();
        if (ch) {
          try {
            ch.postMessage({
              userKey: String(userEmailRef.current).toLowerCase(),
              items: nextItems,
              unreadCount: nextUnread,
              ts: Date.now(),
            });
          } catch {}
        }
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
  }, []);

  // Initial fetch + poll while visible
  useEffect(() => {
    if (!userEmail) return;
    refresh();
    let interval = null;
    if (typeof document !== 'undefined') {
      interval = setInterval(() => {
        if (!document.hidden) refresh();
      }, POLL_INTERVAL_MS);
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
  }, [userEmail, refresh]);

  // Cross-tab adoption — drop messages from other users.
  useEffect(() => {
    const ch = getChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg || !Array.isArray(msg.items)) return;
      const myKey = String(userEmailRef.current || '').toLowerCase();
      const theirKey = String(msg.userKey || '').toLowerCase();
      if (myKey && theirKey && myKey !== theirKey) return;
      setItems(msg.items);
      setUnreadCount(msg.unreadCount ?? 0);
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, []);

  const markRead = useCallback(async (id) => {
    // Optimistic update — the next poll cycle will reconcile the cache.
    setItems(prev => prev.map(n => n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    try { await markNotificationRead(id); }
    catch (err) {
      // Soft-fail: a refresh will reconcile if the server didn't actually
      // record the read state.
      console.warn('[useNotifications] markRead failed:', err.message);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setItems(prev => prev.map(n => n.readAt ? n : { ...n, readAt: new Date().toISOString() }));
    setUnreadCount(0);
    try { await markAllNotificationsRead(); }
    catch (err) { console.warn('[useNotifications] markAllRead failed:', err.message); }
  }, []);

  return useMemo(() => ({
    items,
    unreadCount,
    loading,
    error,
    refresh: () => refresh(),
    markRead,
    markAllRead,
  }), [items, unreadCount, loading, error, refresh, markRead, markAllRead]);
}

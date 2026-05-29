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
  markNotificationUnread,
  markAllNotificationsRead,
} from '../services/notificationsApi';
import { useCurrentDeptId, getCurrentDeptIdSync } from '../lib/current-dept-storage';

const CACHE_KEY_BASE = 'ops_hub_notifications_cache';
const CACHE_TTL_MS = 5 * 60 * 1000;     // 5min cache window for stale-while-revalidate
const POLL_INTERVAL_MS = 30 * 1000;     // refetch every 30s while visible
const CHANNEL_NAME = 'ops_hub_notifications_sync';

// Phase 11+ instant-switch (2026-05-21): per-dept cache namespace so the
// notification feed for HRX vs GIX doesn't cross-contaminate when mohamed
// flips the picker. Server already filters notifications by dept-scope
// cookie (Phase 11d/h), so the only thing missing was a per-dept FE cache.
function cacheKeyFor(userEmail, deptId) {
  const lc = (userEmail || '').toLowerCase();
  const u = lc ? `:${lc}` : '';
  const d = deptId ? `:${deptId}` : ':no-dept';
  return `${CACHE_KEY_BASE}${u}${d}`;
}

function readCache(userEmail, deptId) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKeyFor(userEmail, deptId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (parsed.ts && Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(userEmail, deptId, items, unreadCount) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      cacheKeyFor(userEmail, deptId),
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
  // Read the initial dept-id synchronously so the cache lookup on first
  // render is correct — useCurrentDeptId() catches up via subscription
  // for any subsequent change.
  const initialDeptId = getCurrentDeptIdSync();
  const cached = readCache(userEmail, initialDeptId);
  const [items, setItems] = useState(() => cached?.items || []);
  const [unreadCount, setUnreadCount] = useState(() => cached?.unreadCount ?? 0);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState(null);

  const inFlightRef = useRef(null);
  const mountedRef = useRef(true);
  const userEmailRef = useRef(userEmail);
  useEffect(() => { userEmailRef.current = userEmail; }, [userEmail]);

  const currentDeptId = useCurrentDeptId();
  const currentDeptIdRef = useRef(currentDeptId);
  useEffect(() => { currentDeptIdRef.current = currentDeptId; }, [currentDeptId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Re-hydrate from cache when the user OR dept changes (impersonation,
  // login swap, dept-picker chip switch).
  useEffect(() => {
    inFlightRef.current = null;
    const c = readCache(userEmail, currentDeptId);
    if (c) {
      setItems(c.items);
      setUnreadCount(c.unreadCount ?? 0);
      setLoading(false);
    } else {
      setItems([]);
      setUnreadCount(0);
      setLoading(true);
    }
  }, [userEmail, currentDeptId]);

  const refresh = useCallback(async () => {
    if (!userEmailRef.current) return null;
    if (inFlightRef.current) return inFlightRef.current;
    const run = (async () => {
      try {
        // limit controls READ top-up; server always returns ALL unread up
        // to its UNREAD_CAP, regardless of this param.
        const res = await listNotifications({ limit: 200 });
        if (!mountedRef.current) return null;
        const nextItems = Array.isArray(res?.items) ? res.items : [];
        const nextUnread = Number.isFinite(res?.unreadCount) ? res.unreadCount : 0;
        setItems(nextItems);
        setUnreadCount(nextUnread);
        setError(null);
        writeCache(userEmailRef.current, currentDeptIdRef.current, nextItems, nextUnread);
        const ch = getChannel();
        if (ch) {
          try {
            ch.postMessage({
              userKey: String(userEmailRef.current).toLowerCase(),
              deptKey: currentDeptIdRef.current || null,
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

  // Initial fetch + poll while visible. Re-runs on dept change so the
  // new dept's payload is fetched immediately after the chip switch.
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
  }, [userEmail, currentDeptId, refresh]);

  // Cross-tab adoption — drop messages from other users OR other depts.
  useEffect(() => {
    const ch = getChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg || !Array.isArray(msg.items)) return;
      const myKey = String(userEmailRef.current || '').toLowerCase();
      const theirKey = String(msg.userKey || '').toLowerCase();
      if (myKey && theirKey && myKey !== theirKey) return;
      const myDept = currentDeptIdRef.current || '';
      const theirDept = msg.deptKey || '';
      if ((myDept || theirDept) && myDept !== theirDept) return;
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

  const markUnread = useCallback(async (id) => {
    // Optimistic flip — refresh will reconcile if the server rejected.
    let bumped = false;
    setItems(prev => prev.map(n => {
      if (n.id !== id) return n;
      if (!n.readAt) return n;
      bumped = true;
      return { ...n, readAt: null };
    }));
    if (bumped) setUnreadCount(prev => prev + 1);
    try { await markNotificationUnread(id); }
    catch (err) {
      console.warn('[useNotifications] markUnread failed:', err.message);
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
    markUnread,
    markAllRead,
  }), [items, unreadCount, loading, error, refresh, markRead, markUnread, markAllRead]);
}

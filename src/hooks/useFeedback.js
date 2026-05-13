// ── useFeedback ─────────────────────────────────────────────────────────
// Single-source hook for the Feedback board view. Owns the canonical list,
// applies optimistic updates on votes / status changes / new comments,
// reconciles with the server on a 30s background poll + visibility-return
// catch-up. Per-user state — keyed on the signed-in email so logging in as
// someone else doesn't keep a stale list visible.
//
// Performance: the previous fetch is cached in localStorage (per user, per
// sort key). On next mount the cache paints instantly while the background
// fetch revalidates — no minute-long skeleton on the initial Feedback tab
// open after a deploy.
// ────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listFeedback,
  getFeedback,
  createFeedback,
  updateFeedback,
  deleteFeedback,
  voteFeedback,
  listComments,
  addComment,
} from '../services/feedbackApi';

const POLL_MS = 30 * 1000;

// ── localStorage SWR cache ─────────────────────────────────────────────────
const CACHE_KEY_BASE = 'ops_hub_feedback_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function cacheKey(userEmail, sort) {
  const e = (userEmail || '').toLowerCase();
  return `${CACHE_KEY_BASE}:${e}:${sort || 'top'}`;
}

function readCache(userEmail, sort) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(userEmail, sort));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (parsed.ts && Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return { items: parsed.items, ts: parsed.ts };
  } catch { return null; }
}

function writeCache(userEmail, sort, items) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(cacheKey(userEmail, sort), JSON.stringify({ items, ts: Date.now() })); } catch {}
}

export function useFeedback({ enabled = true, userEmail = null, sort = 'top' } = {}) {
  // Hydrate from cache so the board paints with content on the very first
  // render — eliminates the minute-long skeleton for users on a cold pod.
  const initialCache = readCache(userEmail, sort);
  const [items, setItems] = useState(initialCache?.items || []);
  // Skeleton flips on when (a) we have NO cache at all OR (b) the cache
  // happens to be empty. An empty cache means we'd otherwise show
  // "No feedback yet" while the background refresh is still running —
  // the exact case Mohamed reported 2026-05-13 ("when you first go to
  // it it shows empty until it's loaded"). With this check the skeleton
  // stays up until a real fetch returns, regardless of stale empty
  // caches.
  const initialCachedCount = initialCache?.items?.length ?? 0;
  const [loading, setLoading] = useState(!initialCache || initialCachedCount === 0);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(initialCache?.ts || null);
  const inFlightRef = useRef(null);
  const mountedRef = useRef(true);

  // ── Load / refresh ─────────────────────────────────────────────────────
  const refresh = useCallback(async (opts = {}) => {
    if (!enabled) return null;
    if (inFlightRef.current) return inFlightRef.current;
    // Only flip the skeleton on when we have nothing to show yet — cached
    // data should stay on screen during a revalidation so the user doesn't
    // see content disappear and reappear.
    if (!opts.silent && items.length === 0) setLoading(true);
    const run = (async () => {
      try {
        const res = await listFeedback({ sort });
        if (!mountedRef.current) return null;
        const list = Array.isArray(res?.items) ? res.items : [];
        setItems(list);
        writeCache(userEmail, sort, list);
        setError(null);
        setLastSyncAt(Date.now());
        return res;
      } catch (err) {
        if (mountedRef.current) setError(err?.message || 'Failed to load feedback');
        return null;
      } finally {
        if (mountedRef.current) setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sort, userEmail]);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Initial load + reset on user / sort change. Re-hydrates from the new
  // cache key (per user / per sort) before kicking the network revalidation
  // so the board doesn't blink to empty between sort changes. Same
  // empty-cache rule as the initial state — keep the skeleton up if the
  // cache happens to be empty so the user doesn't see a false "No
  // feedback yet" while the refresh is in-flight.
  useEffect(() => {
    const cached = readCache(userEmail, sort);
    const cachedCount = cached?.items?.length ?? 0;
    setItems(cached?.items || []);
    setLastSyncAt(cached?.ts || null);
    setLoading(!cached || cachedCount === 0);
    if (enabled) refresh({ silent: cachedCount > 0 });
  }, [enabled, userEmail, sort, refresh]);

  // Background poll — paused while tab is hidden, with a visibility-return
  // catch-up. Same pattern the Queue + Announcements hooks use.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refresh({ silent: true });
    };
    const id = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) refresh({ silent: true });
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, refresh]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const create = useCallback(async (payload) => {
    const res = await createFeedback(payload);
    const item = res?.item;
    if (item) setItems(prev => [item, ...prev.filter(i => i.id !== item.id)]);
    return item;
  }, []);

  const patch = useCallback(async (id, body) => {
    // Optimistic — apply locally first so the UI reacts instantly even on
    // slow connections, then reconcile with the server response.
    const prevItems = items;
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...body } : i));
    try {
      const res = await updateFeedback(id, body);
      const item = res?.item;
      if (item) setItems(prev => prev.map(i => i.id === id ? item : i));
      return item;
    } catch (err) {
      setItems(prevItems);
      throw err;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = useCallback(async (id) => {
    const prevItems = items;
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      await deleteFeedback(id);
    } catch (err) {
      setItems(prevItems);
      throw err;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vote optimistically — flip myVote + adjust upvotes / downvotes / score
  // in-place so the row reacts to the click instantly. The server response
  // overwrites the optimistic numbers when it lands so any drift between
  // local arithmetic and the authoritative aggregate gets corrected.
  const vote = useCallback(async (id, nextVote) => {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i;
      const prevVote = Number(i.myVote || 0);
      const upDelta   = (nextVote ===  1 ? 1 : 0) - (prevVote ===  1 ? 1 : 0);
      const downDelta = (nextVote === -1 ? 1 : 0) - (prevVote === -1 ? 1 : 0);
      return {
        ...i,
        myVote: nextVote,
        upvotes:   Math.max(0, (i.upvotes   || 0) + upDelta),
        downvotes: Math.max(0, (i.downvotes || 0) + downDelta),
        score: (i.score || 0) + (upDelta - downDelta),
      };
    }));
    try {
      const res = await voteFeedback(id, nextVote);
      const item = res?.item;
      if (item) setItems(prev => prev.map(i => i.id === id ? item : i));
    } catch (err) {
      // Roll back by triggering a refresh — cleaner than tracking the
      // previous slice ourselves and risking a stale snapshot if other
      // updates landed in the meantime.
      refresh({ silent: true });
      throw err;
    }
  }, [refresh]);

  // Lazy-load the full row (with attachments) on demand. The list endpoint
  // now omits attachment data URIs to keep the cold-load payload tiny;
  // FeedbackView calls this when a row is expanded so the screenshot /
  // attachments render inline. Result is merged into the local item by
  // id — no cache write, no re-list, no echo.
  const loadDetail = useCallback(async (id) => {
    if (!id) return null;
    try {
      const res = await getFeedback(id);
      const item = res?.item;
      if (item) setItems(prev => prev.map(i => i.id === id ? { ...i, ...item } : i));
      return item;
    } catch (err) {
      if (mountedRef.current) setError(err?.message || 'Failed to load attachments');
      return null;
    }
  }, []);

  const fetchComments  = useCallback((id) => listComments(id), []);
  const submitComment  = useCallback(async (id, body) => {
    const res = await addComment(id, body);
    setItems(prev => prev.map(i => i.id === id ? { ...i, commentCount: (i.commentCount || 0) + 1 } : i));
    return res?.item;
  }, []);

  return {
    items,
    loading,
    error,
    lastSyncAt,
    refresh: () => refresh(),
    create,
    patch,
    remove,
    vote,
    loadDetail,
    fetchComments,
    submitComment,
  };
}

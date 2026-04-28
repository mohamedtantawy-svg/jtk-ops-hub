// ── useFeedback ─────────────────────────────────────────────────────────
// Single-source hook for the Feedback board view. Owns the canonical list,
// applies optimistic updates on votes / status changes / new comments,
// reconciles with the server on a 30s background poll + visibility-return
// catch-up. Per-user state — keyed on the signed-in email so logging in as
// someone else doesn't keep a stale list visible.
// ────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listFeedback,
  createFeedback,
  updateFeedback,
  deleteFeedback,
  voteFeedback,
  listComments,
  addComment,
} from '../services/feedbackApi';

const POLL_MS = 30 * 1000;

export function useFeedback({ enabled = true, userEmail = null, sort = 'top' } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const inFlightRef = useRef(null);
  const mountedRef = useRef(true);

  // ── Load / refresh ─────────────────────────────────────────────────────
  const refresh = useCallback(async (opts = {}) => {
    if (!enabled) return null;
    if (inFlightRef.current) return inFlightRef.current;
    if (!opts.silent) setLoading(true);
    const run = (async () => {
      try {
        const res = await listFeedback({ sort });
        if (!mountedRef.current) return null;
        setItems(Array.isArray(res?.items) ? res.items : []);
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
  }, [enabled, sort]);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Initial load + reset on user / sort change.
  useEffect(() => {
    setItems([]);
    if (enabled) refresh();
  }, [enabled, userEmail, refresh]);

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
    fetchComments,
    submitComment,
  };
}

// ── useAnnouncements hook ────────────────────────────────────────────────────
// Manages announcement state — tries the real API first, falls back to local
// INITIAL_COMMS data if the backend is unreachable (demo / offline mode).

import { useState, useEffect, useCallback, useRef } from 'react';
import { INITIAL_COMMS } from '../data/comms';
import {
  fetchAnnouncements,
  createAnnouncement as apiCreate,
  updateAnnouncement as apiUpdate,
  sendAnnouncement as apiSend,
  acknowledgeAnnouncement as apiAcknowledge,
  deleteAnnouncement as apiDelete,
  unarchiveAnnouncement as apiUnarchive,
  fetchComments as apiFetchComments,
  addComment as apiAddComment,
  deleteComment as apiDeleteComment,
  fetchLinks as apiFetchLinks,
  linkAnnouncement as apiLinkAnnouncement,
  unlinkAnnouncement as apiUnlinkAnnouncement,
  reactToAnnouncement as apiReactToAnnouncement,
} from '../services/announcementsApi';

/**
 * Normalises an API announcement object into the shape the frontend expects.
 * Backend returns `readCount` but frontend uses `acks[]` array.
 * When connected to the real API we can't know exact ack IDs from the list
 * endpoint — so we store them locally as they happen.
 */
function normalizeApiAnnouncement(a) {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    body: a.body,
    author: a.author || { id: a.authorId, name: '' },
    sentAt: a.sentAt || '',
    target: a.target,
    status: a.status,
    // acks comes from server read_by (numeric user IDs)
    acks: Array.isArray(a.acks) ? a.acks.map(Number).filter(Boolean) : [],
    link: a.link || '',
    priority: a.priority,
    isPopup: a.isPopup || false,
    imageUrl: a.imageUrl || '',
    isPinned: a.isPinned || a.pinned || false,
    soundKey: a.soundKey || 'chime',
    reactions: a.reactions || {},
    comments: a.comments || [],
    linkedIds: a.linkedIds || [],
  };
}

export function useAnnouncements() {
  const [comms, setComms] = useState(INITIAL_COMMS);
  const [isOnline, setIsOnline] = useState(false); // true when backend responds
  const loadedRef = useRef(false);

  // Track the token so we re-fetch after logout → login cycles
  const lastTokenRef = useRef(null);

  // ── Initial load — try API, fall back to static data ─────────────────────
  useEffect(() => {
    const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('ops_hub_token');
    if (!hasToken) {
      // User logged out — reset so we re-fetch on next login
      loadedRef.current = false;
      lastTokenRef.current = null;
      return;
    }

    const currentToken = localStorage.getItem('ops_hub_token');
    // Re-fetch if we haven't loaded yet, or if the token changed (re-login)
    if (loadedRef.current && lastTokenRef.current === currentToken) return;
    loadedRef.current = true;
    lastTokenRef.current = currentToken;

    (async () => {
      try {
        const data = await fetchAnnouncements({ limit: 200 });
        if (data?.items) {
          setComms(data.items.map(normalizeApiAnnouncement));
          setIsOnline(true);
        }
      } catch (_) {
        // Backend unreachable — keep INITIAL_COMMS (demo mode)
        setIsOnline(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — refs + localStorage only; runs once on mount

  // ── Refresh from API ─────────────────────────────────────────────────────
  // Server is the source of truth for acks now (announcement_acks table),
  // so we replace rather than union with stale local state.
  const refresh = useCallback(async () => {
    try {
      const data = await fetchAnnouncements({ limit: 200 });
      if (data?.items) {
        setComms(prev => {
          // Preserve any local-only drafts (INITIAL_COMMS / offline) that
          // the server doesn't know about yet.
          const serverIds = new Set(data.items.map(a => a.id));
          const localOnly = prev.filter(c => !serverIds.has(c.id) && String(c.id).startsWith('COM-'));
          return [
            ...data.items.map(normalizeApiAnnouncement),
            ...localOnly,
          ];
        });
        setIsOnline(true);
      }
    } catch (_) {
      setIsOnline(false);
    }
  }, []);

  // ── Create ───────────────────────────────────────────────────────────────
  // Always attempt the API call (don't gate on isOnline — it may be stale).
  // Only fall back to local if there's no auth token at all.
  const create = useCallback(async (draft) => {
    const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('ops_hub_token');
    if (hasToken) {
      try {
        const created = await apiCreate(draft);
        const normalised = normalizeApiAnnouncement(created);
        normalised.author = draft.author || normalised.author;
        normalised.acks = [];
        setComms(prev => [normalised, ...prev]);
        setIsOnline(true);
        return normalised;
      } catch (err) {
        console.error('[announcements] create failed:', err.message, err.status);
        // Don't fall through to local — the announcement would be lost on refresh.
        // Re-throw so the caller knows it failed.
        throw err;
      }
    }
    // No token — truly offline / local-only fallback
    const localComm = {
      id: `COM-${Date.now()}`,
      ...draft,
      status: 'draft',
      acks: [],
      sentAt: '',
      isPopup: draft.isPopup || false,
      imageUrl: draft.imageUrl || '',
      link: draft.link || '',
    };
    setComms(prev => [localComm, ...prev]);
    return localComm;
  }, []);

  // ── Send ─────────────────────────────────────────────────────────────────
  const send = useCallback(async (id) => {
    const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('ops_hub_token');
    if (hasToken) {
      try {
        await apiSend(id);
        setTimeout(() => refresh(), 500);
      } catch (e) { console.error('[announcements] send failed:', e.message, e.status); }
    }
    setComms(prev => prev.map(c => c.id === id ? { ...c, status: 'sent', sentAt: new Date().toISOString() } : c));
  }, [refresh]);

  // ── Update ───────────────────────────────────────────────────────────────
  const update = useCallback(async (id, fields) => {
    const prevSnapshot = {};
    setComms(prev => prev.map(c => {
      if (c.id === id) {
        // Capture old values for revert
        for (const k of Object.keys(fields)) prevSnapshot[k] = c[k];
        return { ...c, ...fields };
      }
      return c;
    }));
    if (isOnline) {
      try {
        await apiUpdate(id, fields);
      } catch (e) {
        console.warn('[announcements] update failed, reverting:', e.message);
        setComms(prev => prev.map(c => c.id === id ? { ...c, ...prevSnapshot } : c));
      }
    }
  }, [isOnline]);

  // ── Acknowledge ──────────────────────────────────────────────────────────
  // Optimistic add → server persist → the 15 s poll in App.jsx picks up the
  // canonical ack list on the next tick so all sessions agree.
  const acknowledge = useCallback(async (id, userId) => {
    const uid = Number(userId);
    setComms(prev => prev.map(c =>
      c.id === id && uid && !c.acks.includes(uid)
        ? { ...c, acks: [...c.acks, uid] }
        : c
    ));
    if (isOnline) {
      try {
        const res = await apiAcknowledge(id);
        // Server returns the canonical acks array — trust it
        if (res?.acks) {
          const canonical = res.acks.map(Number).filter(Boolean);
          setComms(prev => prev.map(c => c.id === id ? { ...c, acks: canonical } : c));
        }
      } catch (e) { console.warn('[announcements] acknowledge failed:', e.message); }
    }
  }, [isOnline]);

  // ── Archive ──────────────────────────────────────────────────────────────
  const archive = useCallback(async (id) => {
    // Optimistic update
    setComms(prev => prev.map(c => c.id === id ? { ...c, status: 'archived' } : c));
    if (isOnline) {
      try {
        await apiUpdate(id, { status: 'archived' });
      } catch (e) {
        console.warn('[announcements] archive failed, reverting:', e.message);
        // Revert on failure — server still has the old status
        setComms(prev => prev.map(c => c.id === id && c.status === 'archived' ? { ...c, status: 'sent' } : c));
      }
    }
  }, [isOnline]);

  // ── Delete ───────────────────────────────────────────────────────────────
  const remove = useCallback(async (id) => {
    if (isOnline) {
      try { await apiDelete(id); } catch (e) { console.warn('[announcements] API error:', e.message); }
    }
    setComms(prev => prev.filter(c => c.id !== id));
  }, [isOnline]);

  // ── Pin / Unpin ──────────────────────────────────────────────────────────
  const togglePin = useCallback(async (id) => {
    const comm = comms.find(c => c.id === id);
    if (!comm) return;
    const newPinned = !comm.isPinned;
    if (isOnline) {
      try { await apiUpdate(id, { isPinned: newPinned }); } catch (e) { console.warn('[announcements] API error:', e.message); }
    }
    setComms(prev => prev.map(c => c.id === id ? { ...c, isPinned: newPinned } : c));
  }, [isOnline, comms]);

  // ── Unarchive ─────────────────────────────────────────────────────────
  const unarchive = useCallback(async (id) => {
    setComms(prev => prev.map(c => c.id === id ? { ...c, status: 'sent' } : c));
    if (isOnline) {
      try {
        await apiUnarchive(id);
      } catch (e) {
        console.warn('[announcements] unarchive failed, reverting:', e.message);
        setComms(prev => prev.map(c => c.id === id && c.status === 'sent' ? { ...c, status: 'archived' } : c));
      }
    }
  }, [isOnline]);

  // ── Comments ──────────────────────────────────────────────────────────
  const [comments, setComments] = useState({}); // map: announcementId -> comment[]

  const loadComments = useCallback(async (id) => {
    // First load from local comms data
    const comm = comms.find(c => c.id === id);
    if (comm?.comments?.length) {
      setComments(prev => ({ ...prev, [id]: comm.comments }));
    }
    if (isOnline) {
      try {
        const data = await apiFetchComments(id);
        if (data?.items) setComments(prev => ({ ...prev, [id]: data.items }));
      } catch (e) { console.warn('[announcements] fetch error:', e.message); }
    }
  }, [isOnline, comms]);

  const addCommentFn = useCallback(async (id, body, parentId) => {
    const newComment = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      body,
      parentId: parentId || null,
      authorId: null, // caller will set user info
      authorName: '',
      createdAt: new Date().toISOString(),
    };
    if (isOnline) {
      try {
        const created = await apiAddComment(id, { body, parentId });
        if (created) { newComment.id = created.id || newComment.id; }
      } catch (e) { console.warn('[announcements] API error:', e.message); }
    }
    // Return the comment so the caller can enrich it with user info
    return newComment;
  }, [isOnline]);

  const deleteCommentFn = useCallback(async (announcementId, commentId) => {
    if (isOnline) {
      try { await apiDeleteComment(announcementId, commentId); } catch (e) { console.warn('[announcements] API error:', e.message); }
    }
    setComments(prev => ({
      ...prev,
      [announcementId]: (prev[announcementId] || []).filter(c => c.id !== commentId && c.parentId !== commentId),
    }));
    // Also remove from comms local data
    setComms(prev => prev.map(c => c.id === announcementId
      ? { ...c, comments: (c.comments || []).filter(cm => cm.id !== commentId && cm.parentId !== commentId) }
      : c
    ));
  }, [isOnline]);

  // ── Linked announcements ──────────────────────────────────────────────
  const [links, setLinks] = useState({}); // map: announcementId -> linkedId[]

  const loadLinks = useCallback(async (id) => {
    const comm = comms.find(c => c.id === id);
    if (comm?.linkedIds) {
      setLinks(prev => ({ ...prev, [id]: comm.linkedIds }));
    }
    if (isOnline) {
      try {
        const data = await apiFetchLinks(id);
        if (data?.items) setLinks(prev => ({ ...prev, [id]: data.items }));
      } catch (e) { console.warn('[announcements] fetch error:', e.message); }
    }
  }, [isOnline, comms]);

  const linkAnnouncementFn = useCallback(async (id, targetId) => {
    if (isOnline) {
      try { await apiLinkAnnouncement(id, targetId); } catch (e) { console.warn('[announcements] API error:', e.message); }
    }
    // Add link bidirectionally in local state
    setComms(prev => prev.map(c => {
      if (c.id === id && !(c.linkedIds || []).includes(targetId)) return { ...c, linkedIds: [...(c.linkedIds || []), targetId] };
      if (c.id === targetId && !(c.linkedIds || []).includes(id)) return { ...c, linkedIds: [...(c.linkedIds || []), id] };
      return c;
    }));
    setLinks(prev => ({
      ...prev,
      [id]: [...new Set([...(prev[id] || []), targetId])],
      [targetId]: [...new Set([...(prev[targetId] || []), id])],
    }));
  }, [isOnline]);

  // ── React ───────────────────────────────────────────────────────────────
  const react = useCallback(async (id, emoji) => {
    // Optimistic update
    setComms(prev => prev.map(c => {
      if (c.id !== id) return c;
      const reactions = { ...(c.reactions || {}) };
      reactions[emoji] = (reactions[emoji] || 0) + 1;
      return { ...c, reactions };
    }));
    // Fire API call in background
    if (isOnline) {
      try { await apiReactToAnnouncement(id, emoji); } catch (e) { console.warn('[announcements] react error:', e.message); }
    }
  }, [isOnline]);

  const unlinkAnnouncementFn = useCallback(async (id, targetId) => {
    if (isOnline) {
      try { await apiUnlinkAnnouncement(id, targetId); } catch (e) { console.warn('[announcements] API error:', e.message); }
    }
    // Remove link bidirectionally
    setComms(prev => prev.map(c => {
      if (c.id === id) return { ...c, linkedIds: (c.linkedIds || []).filter(x => x !== targetId) };
      if (c.id === targetId) return { ...c, linkedIds: (c.linkedIds || []).filter(x => x !== id) };
      return c;
    }));
    setLinks(prev => ({
      ...prev,
      [id]: (prev[id] || []).filter(x => x !== targetId),
      [targetId]: (prev[targetId] || []).filter(x => x !== id),
    }));
  }, [isOnline]);

  return {
    comms,
    setComms,
    isOnline,
    refresh,
    create,
    send,
    update,
    acknowledge,
    archive,
    remove,
    togglePin,
    unarchive,
    comments,
    setComments,
    loadComments,
    addComment: addCommentFn,
    deleteComment: deleteCommentFn,
    links,
    loadLinks,
    linkAnnouncement: linkAnnouncementFn,
    unlinkAnnouncement: unlinkAnnouncementFn,
    react,
  };
}

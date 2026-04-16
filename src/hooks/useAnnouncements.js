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
    acks: a.acks || [],
    link: a.link || '',
    priority: a.priority,
    isPopup: a.isPopup || false,
    imageUrl: a.imageUrl || '',
    isPinned: a.isPinned || false,
    reactions: a.reactions || {},
    comments: a.comments || [],
    linkedIds: a.linkedIds || [],
  };
}

export function useAnnouncements() {
  const [comms, setComms] = useState(INITIAL_COMMS);
  const [isOnline, setIsOnline] = useState(false); // true when backend responds
  const loadedRef = useRef(false);

  // ── Initial load — try API, fall back to static data ─────────────────────
  useEffect(() => {
    if (loadedRef.current) return;
    // Don't fire API calls before the user has logged in — there's no token
    // yet, so the request would get a 401. The api.js 401 handler is now
    // safe, but there's no point making a doomed request anyway.
    const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('ops_hub_token');
    if (!hasToken) return; // will try again on next re-render after login
    loadedRef.current = true;

    (async () => {
      try {
        const data = await fetchAnnouncements({ limit: 200 });
        if (data?.items?.length) {
          setComms(data.items.map(normalizeApiAnnouncement));
          setIsOnline(true);
        }
      } catch (_) {
        // Backend unreachable — keep INITIAL_COMMS (demo mode)
        setIsOnline(false);
      }
    })();
  });

  // ── Refresh from API ─────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const data = await fetchAnnouncements({ limit: 200 });
      if (data?.items?.length) {
        setComms(prev => {
          // Merge: keep local acks that we already have
          const localAcks = {};
          prev.forEach(c => { localAcks[c.id] = c.acks || []; });
          return data.items.map(a => {
            const n = normalizeApiAnnouncement(a);
            // Merge local acks with whatever came from the server
            const merged = [...new Set([...(localAcks[n.id] || []), ...(n.acks || [])])];
            return { ...n, acks: merged };
          });
        });
        setIsOnline(true);
      }
    } catch (_) {
      setIsOnline(false);
    }
  }, []);

  // ── Create ───────────────────────────────────────────────────────────────
  const create = useCallback(async (draft) => {
    if (isOnline) {
      try {
        const created = await apiCreate(draft);
        const normalised = normalizeApiAnnouncement(created);
        // Add author info from draft (backend may not return it fully)
        normalised.author = draft.author || normalised.author;
        normalised.acks = [];
        setComms(prev => [normalised, ...prev]);
        return normalised;
      } catch (_) { /* fall through to local */ }
    }
    // Local-only fallback
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
  }, [isOnline]);

  // ── Send ─────────────────────────────────────────────────────────────────
  const send = useCallback(async (id) => {
    if (isOnline) {
      try { await apiSend(id); } catch (e) { console.warn('[announcements] API error:', e.message); }
    }
    setComms(prev => prev.map(c => c.id === id ? { ...c, status: 'sent', sentAt: new Date().toISOString() } : c));
  }, [isOnline]);

  // ── Update ───────────────────────────────────────────────────────────────
  const update = useCallback(async (id, fields) => {
    if (isOnline) {
      try { await apiUpdate(id, fields); } catch (e) { console.warn('[announcements] API error:', e.message); }
    }
    setComms(prev => prev.map(c => c.id === id ? { ...c, ...fields } : c));
  }, [isOnline]);

  // ── Acknowledge ──────────────────────────────────────────────────────────
  const acknowledge = useCallback(async (id, userId) => {
    // Optimistic update — immediately add to acks so popup disappears
    setComms(prev => prev.map(c =>
      c.id === id && !c.acks.includes(userId)
        ? { ...c, acks: [...c.acks, userId] }
        : c
    ));
    // Fire API call in background — don't block UI
    if (isOnline) {
      try { await apiAcknowledge(id); } catch (e) { console.warn('[announcements] acknowledge failed:', e.message); }
    }
  }, [isOnline]);

  // ── Archive ──────────────────────────────────────────────────────────────
  const archive = useCallback(async (id) => {
    if (isOnline) {
      try { await apiUpdate(id, { status: 'archived' }); } catch (e) { console.warn('[announcements] API error:', e.message); }
    }
    setComms(prev => prev.map(c => c.id === id ? { ...c, status: 'archived' } : c));
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
    if (isOnline) {
      try { await apiUnarchive(id); } catch (e) { console.warn('[announcements] API error:', e.message); }
    }
    setComms(prev => prev.map(c => c.id === id ? { ...c, status: 'sent' } : c));
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

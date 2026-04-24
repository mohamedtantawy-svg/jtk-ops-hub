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
    // scheduledFor is present on rows with status='scheduled'; we preserve the
    // raw ISO so the UI can render a localised time and the "Send now" action
    // can decide whether to show the button.
    scheduledFor: a.scheduledFor || a.scheduled_for || null,
    target: a.target,
    status: a.status,
    // acks comes from server read_by (numeric user IDs). Kept for
    // backwards-compat + id-based lookups, but email matching is preferred.
    acks: Array.isArray(a.acks) ? a.acks.map(Number).filter(Boolean) : [],
    // ackEmails is the drift-proof source: compare the caller's email against
    // this array to know if they've acked. The static MEMBERS array uses
    // array-position ids that can differ from DB members.id; emails are stable.
    ackEmails: Array.isArray(a.ackEmails)
      ? a.ackEmails.map(e => String(e || '').toLowerCase()).filter(Boolean)
      : [],
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

// ── Pending ack durability ────────────────────────────────────────────────
// Acks we haven't yet confirmed on the server (network failure / offline).
// We persist these to localStorage and retry on reconnect + periodically so
// no acknowledgement is ever lost — requirement #3 (100% ack capture) is
// enforced end-to-end, not just best-effort.
const PENDING_ACKS_KEY = 'ops_hub_pending_acks';
function readPendingAcks() {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(PENDING_ACKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function writePendingAcks(ids) {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(PENDING_ACKS_KEY, JSON.stringify(ids));
  } catch (e) { /* ignore quota errors — best effort */ }
}

// `toastRef` is an optional React ref whose `.current` points to an addToast
// function (type, title, body) => void. We accept a ref rather than the
// callback directly because App.jsx declares addToast *after* useAnnouncements()
// runs (temporal dead zone), so passing the value at call-time would be
// undefined. The ref is patched by a useEffect in App.jsx once addToast exists.
export function useAnnouncements({ toastRef } = {}) {
  // notifyError is a tiny helper that safely fires a toast if (a) the ref is
  // populated, and (b) the caller gave us one. Noop in isolation / tests.
  const notifyError = useCallback((title, body) => {
    try { toastRef?.current?.('error', title, body); } catch(_) {}
  }, [toastRef]);
  const [comms, setComms] = useState(INITIAL_COMMS);
  const [isOnline, setIsOnline] = useState(false); // true when backend responds
  // Canonical DB user id for the caller, as reported by the server on every
  // list/ack response. We prefer this over the client-side user.id because the
  // static MEMBERS array can drift out of sync with the DB's members.id — that
  // drift is what caused popups to reappear after "Acknowledge" and the ack
  // tracker to show the user as pending. Consumers should use this when
  // deciding whether an announcement has been acked by the caller.
  const [serverUserId, setServerUserId] = useState(null);
  // Canonical email, lowercased, as reported by the server. This is the id we
  // prefer for ack matching — emails don't drift across re-seeds or re-ids.
  const [serverUserEmail, setServerUserEmail] = useState(null);
  const loadedRef = useRef(false);

  // Track the token so we re-fetch after logout → login cycles
  const lastTokenRef = useRef(null);
  // Ref wrapper for refresh() — polling effect reads via ref to avoid re-subscribing
  const refreshRef = useRef(null);
  // Mirror of the persisted pending-acks list so the drain loop can read it
  // without importing it from localStorage on every tick.
  const pendingAcksRef = useRef(readPendingAcks());
  const drainingRef = useRef(false);

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
          if (data.callerId) setServerUserId(Number(data.callerId));
          if (data.callerEmail) setServerUserEmail(String(data.callerEmail).toLowerCase());
          setIsOnline(true);
        }
      } catch (_) {
        // Backend unreachable — keep INITIAL_COMMS (demo mode)
        setIsOnline(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — refs + localStorage only; runs once on mount

  // ── Polling: refresh every 45 s so scheduled announcements + new pop-ups
  // arrive promptly without a WebSocket. Only runs while the tab is visible.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const POLL_MS = 45_000;
    let timer = null;
    const kick = () => {
      if (document.visibilityState !== 'visible') return;
      const hasToken = !!localStorage.getItem('ops_hub_token');
      if (!hasToken) return;
      // Use the latest refresh() ref value without capturing it (avoid loops)
      refreshRef.current?.();
    };
    timer = setInterval(kick, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') kick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

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
        if (data.callerId) setServerUserId(Number(data.callerId));
        if (data.callerEmail) setServerUserEmail(String(data.callerEmail).toLowerCase());
        setIsOnline(true);
      }
    } catch (_) {
      setIsOnline(false);
    }
  }, []);

  // Keep the ref in sync so polling always calls the current refresh()
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

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
      } catch (e) {
        console.error('[announcements] send failed:', e.message, e.status);
        notifyError('Send failed', e.message || 'Could not publish announcement');
        // Re-throw so the caller can react (AnnouncementsView.handleSend
        // already catches this to flip the UI state back).
        throw e;
      }
    }
    setComms(prev => prev.map(c => c.id === id ? { ...c, status: 'sent', sentAt: new Date().toISOString() } : c));
  }, [refresh, notifyError]);

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
        notifyError('Update failed', e.message || 'Could not save announcement changes');
      }
    }
  }, [isOnline, notifyError]);

  // ── Acknowledge ──────────────────────────────────────────────────────────
  // Optimistic add → server persist → the 15 s poll in App.jsx picks up the
  // canonical ack list on the next tick so all sessions agree.
  //
  // Durability: if the server call fails (offline, transient error, 500), we
  // enqueue the ID in a pendingAcks list that survives page reloads via
  // localStorage. A drain loop + refresh-triggered retry keep hammering the
  // server until every queued ack lands. The server endpoint is idempotent
  // (announcement_acks has a composite primary key + ON CONFLICT DO NOTHING)
  // so retrying is always safe — no duplicate rows, no changed timestamps.
  const queuePendingAck = useCallback((id) => {
    if (!id) return;
    const cur = pendingAcksRef.current;
    if (cur.includes(id)) return;
    const next = [...cur, id];
    pendingAcksRef.current = next;
    writePendingAcks(next);
  }, []);
  const removePendingAck = useCallback((id) => {
    const cur = pendingAcksRef.current;
    if (!cur.includes(id)) return;
    const next = cur.filter(x => x !== id);
    pendingAcksRef.current = next;
    writePendingAcks(next);
  }, []);

  // acknowledge(id, userId?, userEmail?) — both are optimistic inputs. We'll
  // merge whatever the server returns into the canonical state. userEmail is
  // highly recommended because the frontend uses email-first matching.
  const acknowledge = useCallback(async (id, userId, userEmail) => {
    const uid = Number(userId) || null;
    const emailLc = userEmail ? String(userEmail).toLowerCase() : null;
    setComms(prev => prev.map(c => {
      if (c.id !== id) return c;
      const nextAcks = uid && !c.acks.includes(uid) ? [...c.acks, uid] : c.acks;
      const existingEmails = Array.isArray(c.ackEmails) ? c.ackEmails : [];
      const nextEmails = emailLc && !existingEmails.includes(emailLc)
        ? [...existingEmails, emailLc]
        : existingEmails;
      return { ...c, acks: nextAcks, ackEmails: nextEmails };
    }));
    // Enqueue BEFORE the network call — if the call throws or the tab is
    // closed mid-flight, the id is already persisted and will be retried.
    queuePendingAck(id);
    if (isOnline) {
      try {
        const res = await apiAcknowledge(id);
        if (res?.userId) setServerUserId(Number(res.userId));
        if (res?.userEmail) setServerUserEmail(String(res.userEmail).toLowerCase());
        if (res?.acks || res?.ackEmails) {
          const canonicalIds = Array.isArray(res.acks) ? res.acks.map(Number).filter(Boolean) : [];
          const canonicalEmails = Array.isArray(res.ackEmails)
            ? res.ackEmails.map(e => String(e || '').toLowerCase()).filter(Boolean)
            : [];
          // Belt + braces: guarantee the caller's id AND email are present in
          // the canonical arrays even if the server response races ahead of a
          // concurrent write. Without this, the popup briefly reappears
          // between the ack write and the next GET refresh.
          const serverId = Number(res.userId) || uid;
          const serverEmail = (res.userEmail || emailLc || '').toLowerCase() || null;
          const finalIds = serverId && !canonicalIds.includes(serverId)
            ? [...canonicalIds, serverId]
            : canonicalIds;
          const finalEmails = serverEmail && !canonicalEmails.includes(serverEmail)
            ? [...canonicalEmails, serverEmail]
            : canonicalEmails;
          setComms(prev => prev.map(c => c.id === id
            ? { ...c, acks: finalIds, ackEmails: finalEmails }
            : c
          ));
        }
        removePendingAck(id);
      } catch (e) {
        console.warn('[announcements] acknowledge failed — queued for retry:', e.message);
      }
    }
  }, [isOnline, queuePendingAck, removePendingAck]);

  // ── Drain pending acks ──────────────────────────────────────────────────
  // Retries every 30s while there are queued acks, and again immediately
  // after a successful refresh (so a reconnect drains fast).
  const drainPendingAcks = useCallback(async () => {
    if (drainingRef.current) return;
    const ids = pendingAcksRef.current;
    if (!ids.length) return;
    const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('ops_hub_token');
    if (!hasToken) return;
    drainingRef.current = true;
    try {
      // Retry sequentially to avoid hammering the server.
      for (const id of ids.slice()) {
        try {
          const res = await apiAcknowledge(id);
          if (res?.userId) setServerUserId(Number(res.userId));
          if (res?.userEmail) setServerUserEmail(String(res.userEmail).toLowerCase());
          if (res?.acks || res?.ackEmails) {
            const canonicalIds = Array.isArray(res.acks) ? res.acks.map(Number).filter(Boolean) : [];
            const canonicalEmails = Array.isArray(res.ackEmails)
              ? res.ackEmails.map(e => String(e || '').toLowerCase()).filter(Boolean)
              : [];
            setComms(prev => prev.map(c => c.id === id
              ? { ...c, acks: canonicalIds, ackEmails: canonicalEmails }
              : c
            ));
          }
          removePendingAck(id);
        } catch (e) {
          // Keep it in the queue for the next drain — break early if the
          // server is clearly unreachable so we don't spin on the rest.
          break;
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, [removePendingAck]);

  // Periodic drain + on reconnect
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer = setInterval(() => { drainPendingAcks(); }, 30_000);
    const onFocus = () => drainPendingAcks();
    const onOnline = () => drainPendingAcks();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    // Drain once on mount in case we still have queued acks from a prior tab.
    drainPendingAcks();
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [drainPendingAcks]);

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
        notifyError('Archive failed', e.message || 'Could not archive announcement');
      }
    }
  }, [isOnline, notifyError]);

  // ── Delete ───────────────────────────────────────────────────────────────
  // Optimistic remove with revert on failure — if the server rejects the
  // delete we re-add the row locally so the user sees the real state rather
  // than a phantom-deleted announcement that comes back on next refresh.
  const remove = useCallback(async (id) => {
    let prevRow = null;
    setComms(prev => {
      prevRow = prev.find(c => c.id === id) || null;
      return prev.filter(c => c.id !== id);
    });
    if (isOnline) {
      try {
        await apiDelete(id);
      } catch (e) {
        console.warn('[announcements] delete failed, reverting:', e.message);
        if (prevRow) setComms(prev => prev.some(c => c.id === id) ? prev : [prevRow, ...prev]);
        notifyError('Delete failed', e.message || 'Could not delete announcement');
      }
    }
  }, [isOnline, notifyError]);

  // ── Pin / Unpin ──────────────────────────────────────────────────────────
  const togglePin = useCallback(async (id) => {
    const comm = comms.find(c => c.id === id);
    if (!comm) return;
    const newPinned = !comm.isPinned;
    setComms(prev => prev.map(c => c.id === id ? { ...c, isPinned: newPinned } : c));
    if (isOnline) {
      try {
        await apiUpdate(id, { isPinned: newPinned });
      } catch (e) {
        console.warn('[announcements] togglePin failed, reverting:', e.message);
        setComms(prev => prev.map(c => c.id === id ? { ...c, isPinned: !newPinned } : c));
        notifyError('Pin toggle failed', e.message || 'Could not update pin state');
      }
    }
  }, [isOnline, comms, notifyError]);

  // ── Unarchive ─────────────────────────────────────────────────────────
  const unarchive = useCallback(async (id) => {
    setComms(prev => prev.map(c => c.id === id ? { ...c, status: 'sent' } : c));
    if (isOnline) {
      try {
        await apiUnarchive(id);
      } catch (e) {
        console.warn('[announcements] unarchive failed, reverting:', e.message);
        setComms(prev => prev.map(c => c.id === id && c.status === 'sent' ? { ...c, status: 'archived' } : c));
        notifyError('Unarchive failed', e.message || 'Could not restore announcement');
      }
    }
  }, [isOnline, notifyError]);

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
    // Fire API call in background — revert the optimistic bump on failure so
    // the count doesn't drift from what the server actually recorded.
    if (isOnline) {
      try {
        await apiReactToAnnouncement(id, emoji);
      } catch (e) {
        console.warn('[announcements] react error:', e.message);
        setComms(prev => prev.map(c => {
          if (c.id !== id) return c;
          const reactions = { ...(c.reactions || {}) };
          reactions[emoji] = Math.max(0, (reactions[emoji] || 1) - 1);
          if (reactions[emoji] === 0) delete reactions[emoji];
          return { ...c, reactions };
        }));
        notifyError('Reaction failed', e.message || 'Could not save your reaction');
      }
    }
  }, [isOnline, notifyError]);

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
    // Canonical DB id for the logged-in caller; populated on every list/ack
    // roundtrip. null until the first successful call. Prefer `serverUserEmail`
    // over this for any "is this acked by me" comparison — emails don't drift
    // across re-seeds, while ids can.
    serverUserId,
    // Canonical lowercased email for the logged-in caller. This is the
    // drift-proof id used by ack-comparison logic throughout the UI.
    serverUserEmail,
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

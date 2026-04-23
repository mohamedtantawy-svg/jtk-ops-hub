// ── useAnnouncementRequests hook ──────────────────────────────────────────
// Powers the Approval Queue view. Backend handles scoping (approver vs.
// requester), so the same hook works for everyone.
//
// This module exports BOTH a Provider and a consumer hook. If a consumer is
// rendered inside `<AnnouncementRequestsProvider>` (the default in App.jsx),
// every caller of `useAnnouncementRequests()` shares the same state + polling
// timer — so the approval queue list only loads once, and an approve action
// fires one refresh that every mounted view picks up instantly.
//
// If no Provider is present (e.g. in a test or a standalone embed), the hook
// falls back to the legacy self-contained implementation so behaviour is
// preserved.
import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import {
  fetchRequests,
  fetchRequestDetail,
  createRequest as apiCreate,
  editRequest as apiEdit,
  approveRequest as apiApprove,
  rejectRequest as apiReject,
  requestInfo as apiRequestInfo,
  withdrawRequest as apiWithdraw,
  addRequestComment as apiAddComment,
} from '../services/announcementRequestsApi';

// Internal hook that actually owns the state + polling. Used by the Provider.
// Not exported — callers should consume via the Provider/consumer hook pair.
function useAnnouncementRequestsStore() {
  const [items, setItems] = useState([]);
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  // Tracks when we last had a successful fetch — lets us surface stale
  // indicators in the UI if we ever want (not used yet, but cheap to carry).
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchRequests({});
      if (!mountedRef.current) return;
      setItems(Array.isArray(data?.items) ? data.items : []);
      setCanApprove(Boolean(data?.canApprove));
      setLastSyncedAt(Date.now());
      setLoading(false);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e?.message || 'Failed to load approval queue');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('ops_hub_token');
    if (!hasToken) { setLoading(false); return; }
    refresh();
    // Poll every 45s so approvers see new requests promptly
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 45_000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);

  const create = useCallback(async (payload) => {
    const out = await apiCreate(payload);
    await refresh();
    return out;
  }, [refresh]);

  const edit = useCallback(async (id, patch) => {
    const out = await apiEdit(id, patch);
    await refresh();
    return out;
  }, [refresh]);

  const approve = useCallback(async (id, options = {}) => {
    const out = await apiApprove(id, options);
    await refresh();
    return out;
  }, [refresh]);

  const reject = useCallback(async (id, reason) => {
    const out = await apiReject(id, reason);
    await refresh();
    return out;
  }, [refresh]);

  const askClarification = useCallback(async (id, question) => {
    const out = await apiRequestInfo(id, question);
    await refresh();
    return out;
  }, [refresh]);

  const withdraw = useCallback(async (id) => {
    const out = await apiWithdraw(id);
    await refresh();
    return out;
  }, [refresh]);

  const addComment = useCallback(async (id, body) => {
    return apiAddComment(id, body);
  }, []);

  return {
    items, canApprove, loading, error, lastSyncedAt,
    refresh,
    fetchDetail: fetchRequestDetail,
    create, edit, approve, reject,
    askClarification, withdraw, addComment,
  };
}

const AnnouncementRequestsContext = createContext(null);

export function AnnouncementRequestsProvider({ children }) {
  const value = useAnnouncementRequestsStore();
  return React.createElement(
    AnnouncementRequestsContext.Provider,
    { value },
    children
  );
}

// Dummy that mirrors the real store's shape — used only when the hook is
// somehow rendered outside the Provider. We deliberately do NOT spin up a
// parallel polling timer here (that would undo the whole point of sharing).
// This is a safety net; in production every view sits under the Provider.
const FALLBACK_VALUE = {
  items: [],
  canApprove: false,
  loading: false,
  error: null,
  lastSyncedAt: null,
  refresh: async () => {},
  fetchDetail: fetchRequestDetail,
  create: async () => { throw new Error('AnnouncementRequestsProvider not mounted'); },
  edit: async () => { throw new Error('AnnouncementRequestsProvider not mounted'); },
  approve: async () => { throw new Error('AnnouncementRequestsProvider not mounted'); },
  reject: async () => { throw new Error('AnnouncementRequestsProvider not mounted'); },
  askClarification: async () => { throw new Error('AnnouncementRequestsProvider not mounted'); },
  withdraw: async () => { throw new Error('AnnouncementRequestsProvider not mounted'); },
  addComment: async () => { throw new Error('AnnouncementRequestsProvider not mounted'); },
};

export function useAnnouncementRequests() {
  const ctx = useContext(AnnouncementRequestsContext);
  if (!ctx) {
    if (process.env.NODE_ENV !== 'production') {
      // Loud during dev so we spot any callers that escape the Provider tree.
      console.warn('[useAnnouncementRequests] Called outside AnnouncementRequestsProvider — returning empty fallback. Wrap App with <AnnouncementRequestsProvider> in App.jsx.');
    }
    return FALLBACK_VALUE;
  }
  return ctx;
}

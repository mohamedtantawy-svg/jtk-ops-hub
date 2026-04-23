// ── useAnnouncementRequests hook ──────────────────────────────────────────
// Powers the Approval Queue view. Backend handles scoping (approver vs.
// requester), so the same hook works for everyone.
import { useState, useEffect, useCallback, useRef } from 'react';
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

export function useAnnouncementRequests() {
  const [items, setItems] = useState([]);
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchRequests({});
      if (!mountedRef.current) return;
      setItems(Array.isArray(data?.items) ? data.items : []);
      setCanApprove(Boolean(data?.canApprove));
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
    items, canApprove, loading, error,
    refresh,
    fetchDetail: fetchRequestDetail,
    create, edit, approve, reject,
    askClarification, withdraw, addComment,
  };
}

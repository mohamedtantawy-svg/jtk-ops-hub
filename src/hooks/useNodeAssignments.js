// ── useNodeAssignments (Phase 12a, 2026-05-25) ─────────────────────────────
// Data hook for the per-department SWAT Functions + Responsibilities tables.
//
// Returns the full list for a node + the set of emails currently on approved
// leave (server-computed). The FE consumes `oooEmails` to decorate rows
// where any primary assignee is on leave so the "Backup covering" badge
// can render without a second roundtrip.
//
// SWR semantics: shows cached rows immediately, refetches in the background
// when the node changes or on visibility change. Mutations roundtrip then
// reconcile rather than optimistic — these are admin-touched lists where
// correctness beats latency.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listNodeAssignments,
  createNodeAssignment,
  patchNodeAssignment,
  archiveNodeAssignment,
} from '../services/orgApi';

const REFRESH_TTL_MS = 60_000;

export function useNodeAssignments(nodeId) {
  const [assignments, setAssignments] = useState([]);
  const [oooEmails, setOooEmails] = useState(() => new Set());
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetchAtRef = useRef(0);
  const inFlightRef = useRef(false);
  // Keep a ref to the current nodeId so the polling tick reads the latest
  // value without re-binding the effect (per skill mistake #24).
  const nodeIdRef = useRef(nodeId);
  useEffect(() => { nodeIdRef.current = nodeId; }, [nodeId]);

  const reload = useCallback(async (opts = {}) => {
    const targetNodeId = opts.nodeId ?? nodeIdRef.current;
    if (!targetNodeId) {
      setAssignments([]); setOooEmails(new Set()); setCanEdit(false);
      setLoading(false);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const res = await listNodeAssignments(targetNodeId);
      // Guard against late responses for a node we no longer care about.
      if (nodeIdRef.current !== targetNodeId) return;
      setAssignments(Array.isArray(res?.assignments) ? res.assignments : []);
      setOooEmails(new Set((res?.oooEmails || []).map(e => String(e).toLowerCase())));
      setCanEdit(res?.canEdit === true);
      setError(null);
      lastFetchAtRef.current = Date.now();
    } catch (err) {
      setError(err);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // Refetch whenever the target node changes.
  useEffect(() => {
    if (!nodeId) {
      setAssignments([]); setOooEmails(new Set()); setCanEdit(false);
      return;
    }
    reload({ nodeId });
  }, [nodeId, reload]);

  // Light visibility refresh so a returning admin sees fresh OOO state +
  // any peer edits without manual reload.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchAtRef.current < REFRESH_TTL_MS) return;
      reload();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [reload]);

  const create = useCallback(async (payload) => {
    if (!nodeIdRef.current) throw new Error('No node selected');
    const res = await createNodeAssignment(nodeIdRef.current, payload);
    await reload();
    return res?.assignment || null;
  }, [reload]);

  const update = useCallback(async (assignmentId, patch) => {
    if (!nodeIdRef.current) throw new Error('No node selected');
    const res = await patchNodeAssignment(nodeIdRef.current, assignmentId, patch);
    await reload();
    return res?.assignment || null;
  }, [reload]);

  const archive = useCallback(async (assignmentId) => {
    if (!nodeIdRef.current) throw new Error('No node selected');
    await archiveNodeAssignment(nodeIdRef.current, assignmentId);
    await reload();
  }, [reload]);

  return {
    assignments,
    oooEmails,
    canEdit,
    loading,
    error,
    reload,
    create,
    update,
    archive,
  };
}

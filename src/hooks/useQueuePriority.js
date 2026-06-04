// ── useQueuePriority ──────────────────────────────────────────────────────
// Reads and writes the per-department "Priority of the day" message that the
// Workspace landing board shows to every team member. Admin-only on the write
// side (server enforces too). Dept-scoped (2026-06-04): the localStorage cache
// is keyed per dept and the banner refetches on a super-admin dept switch, so
// each dept sees its own priority — never HRX's.
//
// State shape mirrors /api/v1/settings/queue-priority:
//   { priority: { headline, message }, updatedBy, updatedAt, isDefault }
//
// Saves return the new state so the caller can paint optimistically + roll
// back on error. localStorage cache so the banner doesn't blank-flash on
// re-mounts within a session.

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../services/api';
import { useCurrentDeptId, getCurrentDeptIdSync } from '../lib/current-dept-storage';

const LS_BASE = 'ops_hub_queue_priority_v1';
const lsKeyFor = (deptId) => (deptId ? `${LS_BASE}:${deptId}` : LS_BASE);

function readLs(deptId) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(lsKeyFor(deptId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeLs(deptId, value) {
  try { localStorage.setItem(lsKeyFor(deptId), JSON.stringify(value)); } catch {}
}

export function useQueuePriority() {
  const deptId = useCurrentDeptId();
  const [data, setData] = useState(() => readLs(getCurrentDeptIdSync()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const inFlightRef = useRef(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    setLoading(true);
    setError(null);
    // Pin the dept at call time so the response caches under the dept it was
    // fetched for, even if the user switches mid-flight.
    const dept = getCurrentDeptIdSync();
    const run = (async () => {
      try {
        const res = await apiFetch('/settings/queue-priority');
        setData(res);
        writeLs(dept, res);
        return res;
      } catch (err) {
        setError(err?.message || 'Could not load priority');
        return null;
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, []);

  // Repaint from the target dept's cache + refetch whenever the dept changes
  // (super-admin switch). apiFetch already carries the dept cookie/header, so
  // the server returns the new dept's priority.
  useEffect(() => {
    setData(readLs(deptId));
    refresh();
  }, [deptId, refresh]);

  const save = useCallback(async ({ headline, message }) => {
    setSaving(true);
    setError(null);
    const dept = getCurrentDeptIdSync();
    try {
      const res = await apiFetch('/settings/queue-priority', {
        method: 'PUT',
        body: JSON.stringify({ priority: { headline, message } }),
      });
      setData(res);
      writeLs(dept, res);
      return { ok: true, data: res };
    } catch (err) {
      setError(err?.message || 'Failed to save');
      return { ok: false, error: err?.message };
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    priority: data?.priority || null,
    updatedBy: data?.updatedBy || null,
    updatedAt: data?.updatedAt || null,
    isDefault: !!data?.isDefault,
    loading,
    saving,
    error,
    refresh,
    save,
  };
}

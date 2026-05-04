// ── useQueuePriority ──────────────────────────────────────────────────────
// Reads and writes the global "Priority of the day" message that the
// Workspace landing board shows to every team member. Admin-only on the
// write side (server enforces too).
//
// State shape mirrors /api/v1/settings/queue-priority:
//   { priority: { headline, message }, updatedBy, updatedAt, isDefault }
//
// Saves return the new state so the caller can paint optimistically + roll
// back on error. localStorage cache so the banner doesn't blank-flash on
// re-mounts within a session.

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../services/api';

const LS_KEY = 'ops_hub_queue_priority_v1';

function readLs() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeLs(value) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(value)); } catch {}
}

export function useQueuePriority() {
  const [data, setData] = useState(() => readLs());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const inFlightRef = useRef(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    setLoading(true);
    setError(null);
    const run = (async () => {
      try {
        const res = await apiFetch('/settings/queue-priority');
        setData(res);
        writeLs(res);
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

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async ({ headline, message }) => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/settings/queue-priority', {
        method: 'PUT',
        body: JSON.stringify({ priority: { headline, message } }),
      });
      setData(res);
      writeLs(res);
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

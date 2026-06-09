// ── usePerfWarnings ─────────────────────────────────────────────────────────
// Loads performance warnings for a member (or the caller's own when no member),
// with issue / acknowledge / resolve / delete. Server enforces who can see/issue.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listPerfWarnings, issuePerfWarning, patchPerfWarning, deletePerfWarning,
} from '../services/performanceApi';

export function usePerfWarnings({ member = null, enabled = true } = {}) {
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const seqRef = useRef(0);
  const memberRef = useRef(member);
  memberRef.current = member;

  const refresh = useCallback(() => {
    if (!enabled) return null;
    const seq = ++seqRef.current;
    setLoading(true);
    return (async () => {
      try {
        const res = await listPerfWarnings({ member: memberRef.current });
        if (seq !== seqRef.current) return;
        setWarnings(Array.isArray(res?.warnings) ? res.warnings : []);
        setError(null);
      } catch (err) {
        if (seq !== seqRef.current) return;
        if (err?.status === 403) { setWarnings([]); setError(null); }
        else setError(err?.message || 'Failed to load warnings');
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    })();
  }, [enabled]);

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [enabled, member, refresh]);

  const issue = useCallback(async (payload) => { const r = await issuePerfWarning(payload); refresh(); return r?.warning || null; }, [refresh]);
  const patch = useCallback(async (id, p) => { const r = await patchPerfWarning(id, p); refresh(); return r?.warning || null; }, [refresh]);
  const remove = useCallback(async (id) => { setWarnings(prev => prev.filter(w => w.id !== id)); try { await deletePerfWarning(id); } catch { refresh(); } }, [refresh]);

  return { warnings, loading, error, refresh, issue, patch, remove };
}

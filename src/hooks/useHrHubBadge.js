// ── useHrHubBadge ─────────────────────────────────────────────────────────
// Top-nav red number for the HR Hub tab — counts items where:
//   • assignee_email = viewer (the new `assigned` scope on /api/v1/hr-hub)
//   • status ∈ { new, in_progress, on_hold }   (excludes resolved)
//
// Mirrors useUrgentAssistBadge: 60s polling + visibility-change refresh,
// stale-while-revalidate on transient errors. Single network call per
// tick — the `assigned` scope server-filters to assignee=me already, so
// the FE just counts the non-resolved ones.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listHrHubRequests } from '../services/hrHubApi';

const TICK_MS = 60_000;
const NON_RESOLVED = new Set(['new', 'in_progress', 'on_hold']);

export function useHrHubBadge({ enabled = true, userEmail = '' } = {}) {
  const [count, setCount] = useState(0);
  const seqRef = useRef(0);
  const lcEmail = (userEmail || '').toLowerCase();

  const refresh = useCallback(async () => {
    if (!enabled || !lcEmail) return;
    const seq = ++seqRef.current;
    try {
      const res = await listHrHubRequests({ scope: 'assigned', limit: 200 });
      if (seq !== seqRef.current) return;
      const items = Array.isArray(res?.items) ? res.items : [];
      setCount(items.reduce((acc, i) => acc + (NON_RESOLVED.has(i?.status) ? 1 : 0), 0));
    } catch {
      // Preserve previous count on transient error.
      if (seq !== seqRef.current) return;
    }
  }, [enabled, lcEmail]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refresh();
    }, TICK_MS);
    const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) refresh(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, refresh]);

  return count;
}

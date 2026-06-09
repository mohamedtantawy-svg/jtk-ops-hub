// ── usePerfBadge ────────────────────────────────────────────────────────────
// Home-page reminder counts for the Performance tab. One cheap call to
// /api/v1/performance/reminders returns:
//   • managerDue    — # of the caller's direct reports without a finalized
//                     review for the current month (0 for non-managers).
//   • memberPending — 1 if the caller's own current-month review awaits their
//                     reflection or acknowledgment.
//   • count         — managerDue + memberPending (drives the badge dot).
// Mirrors useHrHubBadge: 5-min polling + visibility-change refresh,
// stale-while-revalidate on transient errors.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPerfReminders } from '../services/performanceApi';

const TICK_MS = 5 * 60_000;
const EMPTY = { managerDue: 0, memberPending: 0, count: 0, month: null, year: null };

export function usePerfBadge({ enabled = true, userEmail = '' } = {}) {
  const [state, setState] = useState(EMPTY);
  const seqRef = useRef(0);
  const lcEmail = (userEmail || '').toLowerCase();

  const refresh = useCallback(async () => {
    if (!enabled || !lcEmail) return;
    const seq = ++seqRef.current;
    try {
      const res = await getPerfReminders();
      if (seq !== seqRef.current) return;
      setState({
        managerDue: Number(res?.managerDue || 0),
        memberPending: Number(res?.memberPending || 0),
        count: Number(res?.count || 0),
        month: res?.month ?? null,
        year: res?.year ?? null,
      });
    } catch {
      // Preserve previous counts on transient error.
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

  return state;
}

// ── useMyActiveCoverages ──────────────────────────────────────────────
// Returns the list of handovers the caller is actively covering today
// (status=approved or active, accepted coverage, today in window).
// Auto-refreshes every 2 minutes so a state change on the server
// (cron tick, another user submits a handover for me, lifecycle flip)
// shows up without a manual reload.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMyActiveCoverages } from '../services/handoversApi';

const REFRESH_MS = 2 * 60 * 1000;

// Mirrors queue-scoping._coverageEmailsForRequester (server-side): when a
// coverer accepts an OOO handover, they step into the requester's seat for
// the duration of coverage. The expanded set is whatever the REQUESTER
// would naturally see — own email + their subtree per role. Admin-requester
// expansion is capped at direct reports so accepting one handover never
// promotes the coverer to global admin scope.
//
// rosterAdapter shape:
//   { membersByEmail: Record<emailLc, { access }>,
//     getDirectReports: (emailLc) => Array<{email}|email>,
//     getAllReports:    (emailLc) => Array<{email}|email> }
//
// Pass live-roster adapters (from useTeamMembers) so newly-added members
// resolve correctly; falling back to static baselines drops them silently.
export function expandCoverageScope(activeCoverages, rosterAdapter) {
  const emails = new Set();
  if (!Array.isArray(activeCoverages) || activeCoverages.length === 0) return { emails };
  const membersByEmail = rosterAdapter?.membersByEmail || {};
  const getDirectReports = rosterAdapter?.getDirectReports || (() => []);
  const getAllReports = rosterAdapter?.getAllReports || (() => []);
  const toEmail = (r) => (typeof r === 'string' ? r : (r?.email || '')).toLowerCase();

  for (const c of activeCoverages) {
    const requester = String(c?.requester_email || '').toLowerCase();
    if (!requester) continue;
    emails.add(requester);
    const access = String(membersByEmail[requester]?.access || '').toLowerCase();
    if (access === 'regional_manager') {
      for (const r of getAllReports(requester) || []) {
        const e = toEmail(r);
        if (e) emails.add(e);
      }
    } else if (access === 'team_lead' || access === 'admin') {
      // Admin-cap: direct reports only — never escalate coverer to global admin.
      for (const r of getDirectReports(requester) || []) {
        const e = toEmail(r);
        if (e) emails.add(e);
      }
    }
    // agent / unknown: just the requester themselves (already added).
  }
  return { emails };
}

export function useMyActiveCoverages({ enabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const res = await fetchMyActiveCoverages();
      if (reqIdRef.current !== reqId) return;
      setItems(res?.items || []);
      setError(null);
    } catch (err) {
      if (reqIdRef.current !== reqId) return;
      setError(err);
      // eslint-disable-next-line no-console
      console.warn('[useMyActiveCoverages] fetch failed:', err?.message);
    } finally {
      if (reqIdRef.current === reqId) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  return { items, loading, error, refresh };
}

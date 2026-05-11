// ── useTimeOffEvents ────────────────────────────────────────────────────
// One-shot loader that fetches the caller's visible-scope time-off events
// in a single window (default: -7d to +90d) and groups them by email so
// any surface that wants to render an OOO badge next to an avatar can do
// it without each consumer building its own fetch.
//
// Returns:
//   { eventsByEmail: Map<email, events[]>, loading, error, refresh }

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listTimeOffEvents } from '../services/timeOffApi';
import { isoDate } from '../lib/handover-helpers';

function isoOffsetFromToday(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function useTimeOffEvents({ enabled = true, fromOffsetDays = -7, toOffsetDays = 90 } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const res = await listTimeOffEvents({
        from: isoOffsetFromToday(fromOffsetDays),
        to:   isoOffsetFromToday(toOffsetDays),
      });
      if (reqIdRef.current !== reqId) return;
      setItems(res?.items || []);
      setError(null);
    } catch (err) {
      if (reqIdRef.current !== reqId) return;
      setError(err);
      // Don't blow up consumers — the OOO badge is purely additive UI.
      // eslint-disable-next-line no-console
      console.warn('[useTimeOffEvents] fetch failed:', err?.message);
    } finally {
      if (reqIdRef.current === reqId) setLoading(false);
    }
  }, [enabled, fromOffsetDays, toOffsetDays]);

  useEffect(() => { refresh(); }, [refresh]);

  const eventsByEmail = useMemo(() => {
    const map = new Map();
    const today = isoDate();
    for (const ev of items) {
      const e = (ev?.work_email || '').toLowerCase();
      if (!e) continue;
      // Only carry events relevant to the badge (today's, upcoming, and
      // the next 7 days). Anything past is filtered here so the badge
      // doesn't have to figure it out per render.
      if (ev.end_date && ev.end_date < today) continue;
      if (!map.has(e)) map.set(e, []);
      map.get(e).push(ev);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
    }
    return map;
  }, [items]);

  return { eventsByEmail, loading, error, refresh };
}

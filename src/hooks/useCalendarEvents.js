// ── useCalendarEvents — events for a window, merged Google + local ─────────
// The CalendarView wants a single `events` array per rendered timeframe
// (day / week / month). Both sources get fetched in parallel and merged
// so the UI doesn't have to juggle two lists.
//
// Caching strategy:
//   • In-memory Map keyed by `${timeMin}|${timeMax}` — the fetches return
//     fast once we've loaded a given month. We don't need cross-session
//     IDB cache here because Google Calendar is the source of truth and
//     a 1-5 second fetch on tab open is fine.
//   • Auto-refresh every 2 minutes while the tab is visible, so if a
//     meeting gets added on the user's phone it appears here soon after.
//
// Error handling:
//   • If Google returns 409 (needsReconnect), the hook surfaces
//     `needsReconnect=true` — CalendarView uses this to drop back to the
//     ConnectPrompt even if the cached status said "connected".
//   • Local-events failure does NOT blank Google events (and vice versa).
//     Each source has its own error state so a partial outage doesn't
//     hide everything.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchCalendarEvents, fetchLocalEvents } from '../services/calendarApi';

const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

function cacheKey(timeMin, timeMax) {
  const a = timeMin instanceof Date ? timeMin.toISOString() : String(timeMin);
  const b = timeMax instanceof Date ? timeMax.toISOString() : String(timeMax);
  return `${a}|${b}`;
}

// Merge two lists and dedupe on id (Google IDs are globally unique;
// local events use UUIDs — no collision possible).
function mergeEvents(googleEvents, localEvents) {
  const seen = new Set();
  const out = [];
  for (const e of [...googleEvents, ...localEvents]) {
    if (!e?.id || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  // Sort by startAt — all-day events lexically sort before timed ones
  // because 'YYYY-MM-DD' < 'YYYY-MM-DDTHH:MM:SS'.
  out.sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  return out;
}

export function useCalendarEvents({ enabled, timeMin, timeMax, timeZone } = {}) {
  const [events, setEvents] = useState([]);
  const [googleError, setGoogleError] = useState(null);
  const [localError, setLocalError] = useState(null);
  const [loading, setLoading] = useState(!!enabled);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  // Per-window in-memory cache. Survives re-renders but not remounts,
  // which is exactly right for "while the user is on the Calendar tab
  // navigating between months, don't refetch" behaviour.
  const cacheRef = useRef(new Map());
  const abortRef = useRef(null);

  const key = timeMin && timeMax ? cacheKey(timeMin, timeMax) : null;

  const refresh = useCallback(async (force = false) => {
    if (!enabled || !timeMin || !timeMax) return;
    const currentKey = cacheKey(timeMin, timeMax);

    if (!force) {
      const cached = cacheRef.current.get(currentKey);
      if (cached) {
        setEvents(cached);
        // Still fall through to fetch in background — stale-while-revalidate.
      }
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    // Parallel fetches. allSettled so one failure doesn't cancel the other.
    const [googleRes, localRes] = await Promise.allSettled([
      fetchCalendarEvents({ timeMin, timeMax, timeZone }),
      fetchLocalEvents({ timeMin, timeMax }),
    ]);

    if (ctrl.signal.aborted) return;

    let googleEvents = [];
    if (googleRes.status === 'fulfilled') {
      googleEvents = googleRes.value?.events || [];
      setGoogleError(null);
      setNeedsReconnect(false);
    } else {
      const err = googleRes.reason;
      // 409 / needsReconnect is a soft error — the UI shows ConnectPrompt,
      // but we still render any local events below.
      if (err?.status === 409 || err?.body?.needsReconnect) {
        setNeedsReconnect(true);
        setGoogleError(null);
      } else {
        setGoogleError(err?.message || 'Failed to load Google events');
      }
    }

    let localEvents = [];
    if (localRes.status === 'fulfilled') {
      localEvents = localRes.value?.events || [];
      setLocalError(null);
    } else {
      setLocalError(localRes.reason?.message || 'Failed to load local events');
    }

    const merged = mergeEvents(googleEvents, localEvents);
    cacheRef.current.set(currentKey, merged);
    setEvents(merged);
    setLoading(false);
  }, [enabled, timeMin, timeMax, timeZone]);

  // Fire fetch when window changes.
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    refresh();
    return () => abortRef.current?.abort();
  }, [enabled, key, refresh]);

  // Background refresh every 2 min — but only when the tab is visible.
  // Hidden tabs don't trigger refetch to save battery + quota.
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refresh(true);
      }
    };
    timer = setInterval(tick, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  // Optimistic helpers for the AddEvent modal — on success we inject the
  // created event into state immediately so the user sees it without a
  // full refetch round-trip. Next scheduled refresh confirms server state.
  const addLocalEventOptimistic = useCallback((event) => {
    setEvents((prev) => mergeEvents(prev.filter((e) => e.source !== 'local' || e.id !== event.id), [event]));
    // Invalidate window cache so the next navigation refetches.
    cacheRef.current.clear();
  }, []);

  const removeLocalEventOptimistic = useCallback((id) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    cacheRef.current.clear();
  }, []);

  const stats = useMemo(() => ({
    total: events.length,
    google: events.filter((e) => e.source === 'google').length,
    local: events.filter((e) => e.source === 'local').length,
  }), [events]);

  return {
    events,
    loading,
    googleError,
    localError,
    needsReconnect,
    refresh: () => refresh(true),
    addLocalEventOptimistic,
    removeLocalEventOptimistic,
    stats,
  };
}

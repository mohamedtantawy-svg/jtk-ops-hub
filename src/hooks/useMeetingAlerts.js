// ── useMeetingAlerts — 5-min-before-meeting popup toast ─────────────────────
// Mounted once globally (in App.jsx) so alerts fire regardless of which tab
// the user is currently viewing — you don't want to miss a meeting reminder
// just because you happen to be on the Queue tab.
//
// Design:
//   • Fetches today's events every 2 min (via the same /events endpoint
//     CalendarView uses) so a newly added meeting gets picked up quickly.
//   • Every 30 s scans the upcoming-events list and fires a toast for any
//     event whose start time is within [now + 4m30s, now + 5m30s].
//     The 1-minute window means a slightly-delayed tick doesn't miss the
//     alert, and a slightly-early tick doesn't fire twice.
//   • A `Set` tracks event IDs we've already alerted for today so the
//     same meeting can't fire twice within the same day. Reset at
//     midnight so a recurring daily meeting alerts again tomorrow.
//
// No alert is fired if the user hasn't connected their Google Calendar —
// the /events endpoint returns 409 and we silently skip.

import { useEffect, useRef } from 'react';
import { fetchCalendarEvents } from '../services/calendarApi';

const FETCH_INTERVAL_MS = 2 * 60 * 1000;    // Re-fetch today's events every 2 min
const SCAN_INTERVAL_MS  = 30 * 1000;        // Check "is anything starting soon?" every 30 s
const ALERT_LEAD_MS     = 5 * 60 * 1000;    // 5 min before start
const ALERT_WINDOW_MS   = 60 * 1000;        // ±30 s around the lead time so we don't miss due to tick drift

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export function useMeetingAlerts({ enabled, addToast, setView } = {}) {
  // Ref-based storage so we don't re-run the scan loop on every render.
  const eventsRef = useRef([]);
  const firedRef = useRef(new Set());   // event IDs already alerted today
  const firedDayRef = useRef(null);     // which day those fired IDs belong to

  // ─── Fetcher ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchCalendarEvents({
          timeMin: new Date(),              // only care about what's still upcoming
          timeMax: endOfToday(),
        });
        if (cancelled) return;
        eventsRef.current = res?.events || [];
      } catch {
        // 409 (not connected) / network errors are fine to swallow —
        // we just keep the last known list (or empty).
      }
    };

    load();
    const id = setInterval(load, FETCH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  // ─── Scanner ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return undefined;

    const scan = () => {
      // Reset fired set at midnight so a recurring event alerts again
      // tomorrow (Google gives us a separate event ID per occurrence, but
      // this is belt-and-braces for local events or edge cases).
      const today = startOfToday().toISOString().slice(0, 10);
      if (firedDayRef.current !== today) {
        firedDayRef.current = today;
        firedRef.current = new Set();
      }

      const now = Date.now();
      const lowerBound = now + ALERT_LEAD_MS - ALERT_WINDOW_MS / 2;
      const upperBound = now + ALERT_LEAD_MS + ALERT_WINDOW_MS / 2;

      for (const ev of eventsRef.current) {
        if (!ev?.id || !ev.startAt || ev.allDay) continue;
        if (firedRef.current.has(ev.id)) continue;
        if (ev.status === 'cancelled') continue;

        const startMs = new Date(ev.startAt).getTime();
        if (Number.isNaN(startMs)) continue;
        if (startMs < lowerBound || startMs > upperBound) continue;

        firedRef.current.add(ev.id);

        // Toast body = time + link hint if we have one.
        const timeStr = new Date(ev.startAt).toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit',
        });
        const body = ev.meetingLink
          ? `Starts at ${timeStr} · Click to join`
          : `Starts at ${timeStr}`;

        // The toast system takes (type, title, body, onUndo). We don't
        // have a native "onClick" hook there, so we wire it up as an
        // "onUndo" with label "Join" via a small trick: the Toast component
        // shows the button if onUndo is set. We repurpose it to open the
        // link or navigate to the Calendar tab.
        //
        // NOTE: if the toast UI ever changes to support a distinct action
        // callback, swap this over. The behavioural contract remains the
        // same: clicking the button does the join / navigate.
        const action = () => {
          if (ev.meetingLink) {
            window.open(ev.meetingLink, '_blank', 'noopener,noreferrer');
          } else if (typeof setView === 'function') {
            setView('calendar');
          }
        };

        addToast?.('alert', `Upcoming: ${ev.title || 'Meeting'}`, body, action);
      }
    };

    const id = setInterval(scan, SCAN_INTERVAL_MS);
    // Also scan once immediately so a refresh mid-day picks up anything
    // already in the 5-min window.
    scan();
    return () => clearInterval(id);
  }, [enabled, addToast, setView]);
}

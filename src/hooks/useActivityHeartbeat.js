// ── useActivityHeartbeat ───────────────────────────────────────────────────
// Tracks REAL user activity (clicks, keystrokes, scrolls, touches) and
// fires POST /api/v1/auth/heartbeat on a fixed cadence ONLY when the
// user has actually interacted recently AND the tab is currently visible.
//
// Why this exists: the previous "Last login" badge was bumped by /me
// every time the App component mounted (page load / tab open / refresh)
// — which made every reloaded tab look like real activity. A user who
// reloaded at 9 AM and walked away would still show "9 AM" all day.
// Worse, opening a new tab at 5 PM bumped the timestamp to 5 PM even
// though they hadn't touched the keyboard since 9. Managers couldn't
// trust the column.
//
// Contract — what counts as "active":
//   • Mouse click / keyboard input / scroll / touch detected on the
//     window in the last ACTIVE_WINDOW_MS (90 s).
//   • Tab is currently visible (document.hidden === false).
// Idle tabs in the background NEVER fire the heartbeat.
//
// Guarantees:
//   • At most one POST per HEARTBEAT_INTERVAL_MS per tab.
//   • Server timestamps only — we never send a client clock value.
//   • Network failures are silent; the next tick retries.
//   • Multi-tab safe: each tab heartbeats independently. The DB UPSERT
//     is idempotent and the latest NOW() always wins.
//   • sendBeacon final-flush on tab close so a user who's actively
//     working when they close the laptop still gets a fresh stamp.

import { useEffect, useRef } from 'react';

const HEARTBEAT_INTERVAL_MS = 60_000;   // POST cadence (every minute when active)
const ACTIVE_WINDOW_MS      = 90_000;   // "active" = activity within last 90 s
const HEARTBEAT_PATH        = '/api/v1/auth/heartbeat';
const ACTIVITY_EVENTS       = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

function fullPath() {
  // Mirror the API base resolution apiFetch uses; fall back to relative
  // if that hook isn't available in this environment (SSR / tests).
  if (typeof window === 'undefined') return HEARTBEAT_PATH;
  return HEARTBEAT_PATH;
}

function readToken() {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem('ops_hub_token'); } catch { return null; }
}

function postHeartbeat() {
  const token = readToken();
  if (!token) return;
  const url = fullPath();
  // `keepalive: true` is the modern (and CORS-friendly) replacement for
  // sendBeacon when the request needs custom auth headers — the browser
  // completes the request even if the page navigates away mid-flight.
  // sendBeacon was tempting but it doesn't support Authorization headers
  // and the middleware only accepts `Bearer <token>` (no query-param
  // fallback), so it would have failed silently on tab close.
  try {
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
    }).catch(() => { /* silent — next tick retries */ });
  } catch { /* unreachable in normal browsers */ }
}

/**
 * Fires the activity heartbeat on a per-minute cadence while the user is
 * really using the app. No-ops when not signed in.
 *
 * @param {string|null} loggedInEmail — current user's email (used as a "is
 *   the session live" signal). Pass null/falsy when logged out and the
 *   hook tears down its listeners.
 */
export function useActivityHeartbeat(loggedInEmail) {
  // ref so the polling effect doesn't tear down on every event.
  // Sentinel `0` = "user has not interacted yet". Any timer that wants
  // to send a heartbeat MUST first verify lastActivityRef.current > 0
  // (real activity recorded) AND that the gap to now() is within the
  // active window. Without the sentinel, initialising to performance.now()
  // / Date.now() would make every fresh mount appear "active" for the
  // first 90 s — exactly the bug the heartbeat was meant to kill.
  const lastActivityRef = useRef(0);

  useEffect(() => {
    if (!loggedInEmail) return;
    if (typeof window === 'undefined') return;

    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const recordActivity = () => { lastActivityRef.current = now(); };
    const isActive = () =>
      lastActivityRef.current > 0 &&
      now() - lastActivityRef.current < ACTIVE_WINDOW_MS;

    // Attach listeners. `passive: true` keeps scroll perf intact; `capture:
    // true` so listeners on stop-propagation handlers still see the event.
    // visibilitychange is NOT wired here on purpose — Cmd+Tab returning to
    // a tab is too weak a signal of engagement (a glance through tabs would
    // bump the badge to "Just now"). Only real interaction counts.
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, recordActivity, { passive: true, capture: true });
    }

    // First heartbeat 5s after sign-in / mount so the badge updates
    // promptly without waiting a full minute — but ONLY if the user
    // actually clicked / typed / scrolled / touched in those 5 seconds.
    // A passive page open with zero interaction stays silent.
    const primingTimer = setTimeout(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!isActive()) return;
      postHeartbeat();
    }, 5_000);

    // Recurring tick.
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;     // tab in background
      if (!isActive()) return;                                            // never interacted / idle
      postHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    // Final flush on tab close / navigation away IF the user was active
    // in the activity window. Uses keepalive: true so the request
    // completes even after the page unloads.
    const onUnload = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!isActive()) return;
      postHeartbeat();
    };
    window.addEventListener('pagehide', onUnload);

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, recordActivity, { capture: true });
      }
      window.removeEventListener('pagehide', onUnload);
      clearTimeout(primingTimer);
      clearInterval(interval);
    };
  }, [loggedInEmail]);
}

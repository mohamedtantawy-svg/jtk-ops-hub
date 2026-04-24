// ── useCalendarConnection — connect/disconnect + status for Google Calendar ─
// Exposes the connection lifecycle so CalendarView can render:
//   • "Connect Google Calendar" card when !connected
//   • Small "Connected as alice@deel.com  [Disconnect]" strip when connected
//   • Inline error banner when connection_status.lastError is non-null
//
// Also processes the `?calendar=connected|error&reason=...` query string
// that the OAuth callback route redirects back with, so the user sees a
// toast as soon as they land back in the app.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchCalendarConnection,
  startCalendarOAuth,
  disconnectCalendar,
} from '../services/calendarApi';

// Human-readable reasons for the callback error query-string. Keep the
// keys in sync with the redirectToApp() calls in the /callback route.
const ERROR_REASONS = {
  'access_denied': 'You denied access on the Google consent screen.',
  'missing-params': 'Google did not return a valid authorization code. Try again.',
  'invalid-state': 'The connect session expired. Please try again.',
  'missing-scopes': 'The required Calendar permission was not granted.',
  'token-exchange': 'We could not exchange the code with Google. Try again.',
  'persist': 'We could not save your connection. Try again.',
  'invalid_grant': 'Your Google account refused the request. Try again.',
};

export function useCalendarConnection({ enabled, addToast } = {}) {
  const [status, setStatus] = useState(null); // null=loading, {}=resolved
  const [loading, setLoading] = useState(!!enabled);
  const [connectError, setConnectError] = useState(null);

  // Used by refresh() to cancel in-flight calls when the hook unmounts.
  const abortRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const data = await fetchCalendarConnection();
      if (ctrl.signal.aborted) return;
      setStatus(data || { connected: false });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      // 403 means owner-gate — in that case connection is effectively "off".
      setStatus({ connected: false, error: err.message });
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    refresh();
    return () => abortRef.current?.abort();
  }, [enabled, refresh]);

  // Read back query-string signals from the OAuth callback redirect.
  // Runs once on mount, then removes the params so a second refresh doesn't
  // re-trigger the toast.
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const calendarFlag = params.get('calendar');
    if (!calendarFlag) return;

    const reason = params.get('reason');
    if (calendarFlag === 'connected') {
      addToast?.('success', 'Calendar connected', 'Your events will load in a moment.');
      // Refresh connection status so the UI flips to "connected".
      refresh();
    } else if (calendarFlag === 'error') {
      const msg = ERROR_REASONS[reason] || 'Connection failed. Please try again.';
      setConnectError(msg);
      addToast?.('alert', 'Could not connect Calendar', msg);
    }

    // Clean the URL so a refresh doesn't retrigger.
    params.delete('calendar');
    params.delete('reason');
    // Also drop the tab= param the callback added so we don't override
    // a later setView('briefing') navigation.
    params.delete('tab');
    const cleanQs = params.toString();
    const newUrl = `${window.location.pathname}${cleanQs ? `?${cleanQs}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', newUrl);
  }, [enabled, addToast, refresh]);

  // Kick off the connect flow. We return a promise so CalendarView can
  // show a spinner on the button until we navigate away.
  const connect = useCallback(async () => {
    setConnectError(null);
    try {
      const { authUrl } = await startCalendarOAuth();
      if (!authUrl) throw new Error('No authUrl returned');
      window.location.href = authUrl;
    } catch (err) {
      const msg = err.message || 'Failed to start connection';
      setConnectError(msg);
      addToast?.('alert', 'Connection failed', msg);
    }
  }, [addToast]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectCalendar();
      setStatus({ connected: false });
      addToast?.('success', 'Calendar disconnected');
    } catch (err) {
      addToast?.('alert', 'Could not disconnect', err.message);
    }
  }, [addToast]);

  return {
    connected: !!status?.connected,
    mode: status?.mode || null,
    serviceAccountEmail: status?.serviceAccountEmail || null,
    googleEmail: status?.googleEmail || null,
    connectedAt: status?.connectedAt || null,
    lastError: status?.lastError || null,
    loading,
    connectError,
    refresh,
    connect,
    disconnect,
  };
}

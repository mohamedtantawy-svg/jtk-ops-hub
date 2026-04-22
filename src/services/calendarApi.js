// ── Calendar API client (frontend) ──────────────────────────────────────────
// Thin JSON-over-fetch wrappers around /api/v1/calendar/*. All calls go
// through apiFetch so they inherit auth headers + retry + 401 handling.
//
// Server endpoints (see app/api/v1/calendar/):
//   POST   /calendar/oauth/start         → { authUrl }
//   GET    /calendar/connection          → { connected, googleEmail, ... }
//   DELETE /calendar/connection          → { ok }
//   GET    /calendar/events              → { events }
//   GET    /calendar/local-events        → { events }
//   POST   /calendar/local-events        → { event }
//   DELETE /calendar/local-events?id=... → { ok }

import { apiFetch } from './api';

// ─── OAuth handshake ────────────────────────────────────────────────────────

/**
 * Begin the Google Calendar connect flow. Returns the URL the browser
 * should navigate to. Callers typically do:
 *   const { authUrl } = await startCalendarOAuth();
 *   window.location.href = authUrl;
 */
export async function startCalendarOAuth() {
  return apiFetch('/calendar/oauth/start', { method: 'POST' });
}

// ─── Connection status ──────────────────────────────────────────────────────

export async function fetchCalendarConnection() {
  return apiFetch('/calendar/connection');
}

export async function disconnectCalendar() {
  return apiFetch('/calendar/connection', { method: 'DELETE' });
}

// ─── Events ─────────────────────────────────────────────────────────────────

/**
 * Fetch Google events in a time range. `timeMin` / `timeMax` accept Date
 * objects or ISO strings.
 */
export async function fetchCalendarEvents({ timeMin, timeMax, timeZone } = {}) {
  const toISO = (v) => (v instanceof Date ? v.toISOString() : String(v));
  const params = new URLSearchParams();
  params.set('timeMin', toISO(timeMin));
  params.set('timeMax', toISO(timeMax));
  if (timeZone) params.set('timeZone', timeZone);
  return apiFetch(`/calendar/events?${params.toString()}`);
}

// ─── Local events ──────────────────────────────────────────────────────────

export async function fetchLocalEvents({ timeMin, timeMax } = {}) {
  const toISO = (v) => (v instanceof Date ? v.toISOString() : String(v));
  const params = new URLSearchParams();
  params.set('timeMin', toISO(timeMin));
  params.set('timeMax', toISO(timeMax));
  return apiFetch(`/calendar/local-events?${params.toString()}`);
}

/**
 * Create a local-only event.
 * @param {{ title: string, description?: string, startAt: string|Date, endAt: string|Date, color?: string }} input
 */
export async function createLocalEvent(input) {
  const toISO = (v) => (v instanceof Date ? v.toISOString() : String(v));
  const body = {
    title: input.title,
    description: input.description || '',
    startAt: toISO(input.startAt),
    endAt: toISO(input.endAt),
    color: input.color || 'blue',
  };
  return apiFetch('/calendar/local-events', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteLocalEvent(id) {
  return apiFetch(`/calendar/local-events?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

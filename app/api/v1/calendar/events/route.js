// ── GET /api/v1/calendar/events ─────────────────────────────────────────────
// Fetch events from the user's primary Google Calendar within a time window.
//
// Query params:
//   timeMin  — ISO8601 (required). Inclusive lower bound.
//   timeMax  — ISO8601 (required). Exclusive upper bound.
//   timeZone — IANA name, optional. Defaults to the calendar's own TZ.
//
// Response:
//   { events: NormalizedEvent[] }
//
// Error modes:
//   401 → user not authenticated
//   403 → not whitelisted for the integration
//   409 → user hasn't connected their Google Calendar (needs to reconnect)
//   502 → Google upstream error
//
// 409 is a signal to the client to show the "Connect" prompt again.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import {
  getAccessToken,
  listEvents,
  normalizeEvent,
} from '../../../../../src/lib/google-calendar';
import { getConnectionStatus } from '../../../../../src/lib/calendar-token-store';

const OWNER_EMAIL = 'mohamed.tantawy@deel.com';

// Clamp the query window to prevent someone asking for 5 years of events
// and killing the upstream quota. Monthly view needs ~31 days; we allow a
// bit of headroom for prefetching.
const MAX_WINDOW_DAYS = 62;

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.email.toLowerCase() !== OWNER_EMAIL) {
    return NextResponse.json({ error: 'Calendar integration is in limited rollout' }, { status: 403 });
  }

  const url = new URL(req.url);
  const timeMin = parseDate(url.searchParams.get('timeMin'));
  const timeMax = parseDate(url.searchParams.get('timeMax'));
  const timeZone = url.searchParams.get('timeZone') || undefined;

  if (!timeMin || !timeMax) {
    return NextResponse.json({ error: 'timeMin and timeMax are required ISO8601' }, { status: 400 });
  }
  if (timeMax <= timeMin) {
    return NextResponse.json({ error: 'timeMax must be after timeMin' }, { status: 400 });
  }
  const windowMs = timeMax.getTime() - timeMin.getTime();
  if (windowMs > MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: `Window too wide — max ${MAX_WINDOW_DAYS} days` }, { status: 400 });
  }

  // Quick status check so we can return 409 (needs reconnect) distinctly
  // from 500 (upstream blew up). Saves one DB round-trip for the common
  // case where we skip straight to the token fetch.
  const status = await getConnectionStatus(user.email);
  if (!status.connected) {
    return NextResponse.json({ error: 'Not connected', needsReconnect: true }, { status: 409 });
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(user.email);
  } catch (err) {
    if (err.needsReconnect) {
      return NextResponse.json(
        { error: 'Token refresh failed — please reconnect', needsReconnect: true },
        { status: 409 }
      );
    }
    console.error('[calendar/events] token refresh:', err.message);
    return NextResponse.json({ error: 'Upstream auth error' }, { status: 502 });
  }

  if (!accessToken) {
    return NextResponse.json({ error: 'Not connected', needsReconnect: true }, { status: 409 });
  }

  try {
    const raw = await listEvents({
      accessToken,
      calendarId: 'primary',
      timeMin,
      timeMax,
      timeZone,
    });
    const events = raw.map(normalizeEvent);
    return NextResponse.json({ events });
  } catch (err) {
    if (err.statusCode === 401) {
      // Access token was rejected even after refresh — definitely reconnect.
      return NextResponse.json(
        { error: 'Google rejected the token', needsReconnect: true },
        { status: 409 }
      );
    }
    console.error('[calendar/events]', err.message);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 502 });
  }
}

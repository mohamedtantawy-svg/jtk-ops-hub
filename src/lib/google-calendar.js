// ── Google Calendar client — OAuth handshake + Calendar API v3 wrappers ─────
// Server-side only. Everything here runs in Node (the Next.js API routes),
// never in the browser — we handle the client secret and the decrypted
// refresh token, neither of which should ever reach the front-end.
//
// Endpoint references:
//   Auth code URL:   https://accounts.google.com/o/oauth2/v2/auth
//   Token endpoint:  https://oauth2.googleapis.com/token
//   Revoke:          https://oauth2.googleapis.com/revoke
//   Calendar API:    https://www.googleapis.com/calendar/v3
//   Discovery doc:   https://developers.google.com/calendar/api/v3/reference
//
// Scope: `calendar.readonly` only. We do NOT request write scope — "add
// event" in the UI writes to our own calendar_local_events table and is
// intentionally one-way. This keeps the consent screen minimal (no scary
// "edit your calendar" warning) and reduces blast radius if tokens leak.
//
// Access-token caching: Google access tokens live ~1 hour. We store the
// expires_at and refresh lazily — getAccessToken() checks the stored
// expiry and only hits the /token endpoint if we're within 60 s of expiry
// or past it. 60 s safety margin covers clock skew and in-flight requests.

import { getTokens, updateAccessToken, upsertTokens, recordError } from './calendar-token-store.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export const REQUIRED_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
];

// How close to expiry before we proactively refresh. 60 s is enough to
// cover a slow API call round-trip + small clock skew.
const EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Config accessors
// ─────────────────────────────────────────────────────────────────────────────

function getClientConfig() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google Calendar OAuth is not configured — set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET'
    );
  }
  return { clientId, clientSecret };
}

export function getRedirectUri() {
  // Explicit override wins; otherwise derive from NEXTAUTH_URL / BASE_URL.
  if (process.env.GOOGLE_CALENDAR_REDIRECT_URI) {
    return process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  }
  const base = process.env.NEXTAUTH_URL || process.env.BASE_URL;
  if (!base) {
    throw new Error(
      'Cannot derive Calendar OAuth redirect URI — set NEXTAUTH_URL or GOOGLE_CALENDAR_REDIRECT_URI'
    );
  }
  return `${base.replace(/\/$/, '')}/api/v1/calendar/oauth/callback`;
}

export function isCalendarConfigured() {
  return !!(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth handshake
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the URL the user's browser gets redirected to for the consent
 * screen. `state` is our signed CSRF token (see src/lib/oauth-state.js).
 *
 * Params worth noting:
 *   • access_type=offline — required to get a refresh_token back.
 *   • prompt=consent — forces Google to show the consent screen AND return
 *     a fresh refresh_token on every connect. Without this, if the user
 *     already granted consent in the past, Google omits the refresh_token
 *     from the response and we'd only have an access token that expires
 *     in an hour. For a "reconnect" button this is the correct behaviour.
 *   • include_granted_scopes=true — if the same Google account already has
 *     other scopes granted (via another app), we bundle them into the
 *     issued tokens. Harmless and avoids double-prompting.
 */
export function buildAuthUrl(state) {
  const { clientId } = getClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: REQUIRED_SCOPES.join(' '),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code (from the callback URL) for tokens.
 * Returns the raw Google response shape PLUS a computed expires_at_ms.
 *
 * @param {string} code — the ?code= value from the callback request
 * @returns {Promise<{
 *   access_token: string,
 *   refresh_token: string,
 *   expires_in: number,
 *   expires_at_ms: number,
 *   scope: string,
 *   token_type: string,
 *   id_token?: string,
 * }>}
 */
export async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret } = getClientConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Google token exchange failed: ${data.error || res.status} ${data.error_description || ''}`.trim());
    err.googleError = data.error;
    throw err;
  }
  if (!data.refresh_token) {
    // Shouldn't happen because we set prompt=consent, but surface it if it does.
    throw new Error('Google did not return a refresh_token. Try reconnecting — you may need to remove the app from https://myaccount.google.com/permissions first.');
  }

  return {
    ...data,
    expires_at_ms: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

/**
 * Fetch the Google account profile (email, name, picture) using a fresh
 * access token. Called once during first-connect so we can store the
 * `google_email` column and show "Connected as alice@deel.com" in the UI.
 */
export async function fetchUserInfo(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Google userinfo failed: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Exchange a refresh_token for a fresh access_token. Called lazily when
 * the stored access token is expired or nearly so.
 *
 * Google's response usually contains access_token + expires_in only.
 * Occasionally — e.g. after the user revokes and re-grants, or when
 * Google rotates — the response includes a new refresh_token. We return
 * both so the caller (getAccessToken) can update the DB appropriately.
 */
async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Google token refresh failed: ${data.error || res.status} ${data.error_description || ''}`.trim());
    err.googleError = data.error;
    err.statusCode = res.status;
    throw err;
  }

  return {
    access_token: data.access_token,
    expires_in: data.expires_in || 3600,
    expires_at_ms: Date.now() + (data.expires_in || 3600) * 1000,
    // If Google rotated the refresh token, use the new one.
    rotated_refresh_token: data.refresh_token || null,
    scope: data.scope || null,
  };
}

/**
 * Best-effort revoke on disconnect. Google's revoke endpoint accepts
 * either an access_token or a refresh_token; refresh is stronger because
 * it invalidates every access token derived from it. We never throw —
 * local disconnect should always succeed, and a failed revoke doesn't
 * compromise anything (the DB row is gone).
 */
export async function revokeToken(token) {
  if (!token) return { ok: false, reason: 'no-token' };
  try {
    const res = await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-user access-token retrieval (the hot path)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a valid access token for the given ops-hub user, refreshing if
 * needed. Returns null if the user hasn't connected their calendar.
 *
 * On refresh success:
 *   • Updates access_token + expires_at in DB.
 *   • If Google rotated the refresh_token, re-encrypts and stores it too.
 *
 * On refresh failure:
 *   • Records the error to last_error for UI display.
 *   • Throws a user-facing error — the calling route should return
 *     409/401 so the client knows to prompt reconnection.
 */
export async function getAccessToken(userEmail) {
  const tokens = await getTokens(userEmail);
  if (!tokens) return null;

  // Still valid? Use it.
  if (
    tokens.accessToken &&
    tokens.accessTokenExpiresAt &&
    tokens.accessTokenExpiresAt.getTime() - Date.now() > EXPIRY_SAFETY_MARGIN_MS
  ) {
    return tokens.accessToken;
  }

  // Need to refresh.
  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken);

    if (refreshed.rotated_refresh_token) {
      // Google rotated the refresh token — re-encrypt the new one.
      await upsertTokens({
        userEmail,
        refreshToken: refreshed.rotated_refresh_token,
        accessToken: refreshed.access_token,
        accessTokenExpiresAt: refreshed.expires_at_ms,
        scopes: refreshed.scope || tokens.scopes,
        calendarId: tokens.calendarId,
        googleEmail: tokens.googleEmail,
      });
    } else {
      await updateAccessToken({
        userEmail,
        accessToken: refreshed.access_token,
        accessTokenExpiresAt: refreshed.expires_at_ms,
      });
    }

    return refreshed.access_token;
  } catch (err) {
    await recordError({ userEmail, error: err.message });
    // invalid_grant → user revoked via myaccount.google.com, or key rotated.
    // Anything else (network, 5xx) is transient. We annotate for the caller.
    const annotated = new Error(err.message);
    annotated.needsReconnect = err.googleError === 'invalid_grant';
    annotated.googleError = err.googleError;
    throw annotated;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar API calls
// ─────────────────────────────────────────────────────────────────────────────

async function calendarFetch(accessToken, path, params) {
  const url = new URL(`${CALENDAR_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch {}
    const err = new Error(`Google Calendar API ${res.status}: ${body?.error?.message || res.statusText}`);
    err.statusCode = res.status;
    err.googleError = body?.error;
    throw err;
  }
  return res.json();
}

/**
 * List events in a time window. Thin wrapper over the `/events` endpoint
 * with the common defaults wired up:
 *   • singleEvents=true — expand recurring events into occurrences
 *     so the UI doesn't have to apply RRULE logic.
 *   • orderBy=startTime — only valid when singleEvents=true.
 *   • maxResults=250 — Google's ceiling is 2500 but 250 covers a
 *     typical month easily and keeps payloads fast.
 *
 * @param {object} args
 * @param {string} args.accessToken
 * @param {string} [args.calendarId='primary']
 * @param {string|Date} args.timeMin — RFC3339 string or Date
 * @param {string|Date} args.timeMax
 * @param {string} [args.timeZone] — IANA name; defaults to calendar's TZ
 * @param {number} [args.maxResults=250]
 */
export async function listEvents({
  accessToken,
  calendarId = 'primary',
  timeMin,
  timeMax,
  timeZone,
  maxResults = 250,
}) {
  const toISO = (v) => (v instanceof Date ? v.toISOString() : v);
  const data = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    timeMin: toISO(timeMin),
    timeMax: toISO(timeMax),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults,
    timeZone,
  });
  return data.items || [];
}

/**
 * Normalise a Google Calendar event into the shape the UI consumes.
 * Keeps the UI components agnostic of Google's response format so swapping
 * backends later (e.g. Outlook) only means swapping this normalizer.
 *
 * Handled edge cases:
 *   • All-day events — Google sends { date: '2026-04-22' } on start/end
 *     instead of { dateTime: ... }. We surface a boolean `allDay` flag.
 *   • Events with no title — fall back to '(No title)' for UI safety.
 *   • Conference links — prefer conferenceData.entryPoints[].uri of type
 *     'video' (Meet / Zoom), fall back to hangoutLink, fall back to any
 *     URL in the description.
 */
export function normalizeEvent(ev) {
  const allDay = !!(ev.start?.date && !ev.start?.dateTime);
  const startISO = ev.start?.dateTime || ev.start?.date || null;
  const endISO = ev.end?.dateTime || ev.end?.date || null;

  // Find the best meeting link. Try in order:
  // 1. Google Meet / other video conference entry points
  // 2. hangoutLink (legacy)
  // 3. First https:// URL in the description
  let meetingLink = null;
  if (ev.conferenceData?.entryPoints) {
    const video = ev.conferenceData.entryPoints.find((p) => p.entryPointType === 'video');
    if (video?.uri) meetingLink = video.uri;
  }
  if (!meetingLink && ev.hangoutLink) meetingLink = ev.hangoutLink;
  if (!meetingLink && ev.description) {
    const m = ev.description.match(/https?:\/\/\S+/);
    if (m) meetingLink = m[0];
  }

  return {
    id: ev.id,
    title: ev.summary || '(No title)',
    description: ev.description || '',
    location: ev.location || '',
    startAt: startISO,
    endAt: endISO,
    allDay,
    attendees: (ev.attendees || []).map((a) => ({
      email: a.email,
      name: a.displayName || null,
      responseStatus: a.responseStatus,
      organizer: !!a.organizer,
    })),
    organizer: ev.organizer ? { email: ev.organizer.email, name: ev.organizer.displayName } : null,
    htmlLink: ev.htmlLink || null,
    meetingLink,
    status: ev.status,
    source: 'google',
  };
}

// ── Google Calendar — service account auth path ────────────────────────────
// Alternative to the per-user OAuth flow in google-calendar.js. Uses a
// single service-account key (provisioned by Nexus and injected via the
// GOOGLE_APPLICATION_CREDENTIALS_JSON env var) to call the Calendar API
// on behalf of calendars that have been shared with the SA email.
//
// Why this path exists: for the pilot rollout we only read one calendar
// (the owner's), and asking IT to manage a separate OAuth client + consent
// screen + Secrets Manager entries for what is effectively a single-user
// integration is overkill. Nexus already provisions a per-project GCP SA
// with the Calendar API enabled — sharing a calendar with that SA email
// gives us read access without any OAuth dance.
//
// Trade-off: the SA can ONLY read calendars explicitly shared with it.
// If we later expand to team-wide calendar access, we'd either need each
// user to share, or switch to domain-wide delegation (requires a Google
// Workspace admin to authorise the SA client ID + scope pair). For now,
// single-user share is fine.
//
// JWT flow (RFC 7523 — "JWT Bearer Token Grant"):
//   1. Build a JWT claiming { iss: SA email, scope, aud: token URI, iat, exp }
//   2. Sign with RS256 using the SA private key
//   3. POST to token URI with grant_type=jwt-bearer&assertion=<JWT>
//   4. Receive { access_token, expires_in } — valid ~1h
//
// We sign + exchange at most once per hour (cached in-module). Server is
// assumed single-process-per-pod; if we horizontally scale the cache is
// per-pod, which is fine since each pod would just mint its own token.
// At ~1 API call / refresh, we are nowhere near Google's token minting
// quota.

import { createSign } from 'node:crypto';

const TOKEN_URL_DEFAULT = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

// Safety margin before we consider the cached token stale. Google issues
// ~1h tokens; refreshing at T-60s covers an in-flight API call plus clock
// skew without being so eager we refresh needlessly on every request.
const EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let parsedCredsCache = null;

function parseCredentials() {
  if (parsedCredsCache) return parsedCredsCache;
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not set');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON: ${err.message}`);
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Service account JSON missing client_email or private_key');
  }
  parsedCredsCache = parsed;
  return parsed;
}

export function isServiceAccountConfigured() {
  return !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
}

export function getServiceAccountEmail() {
  try {
    return parseCredentials().client_email;
  } catch {
    return null;
  }
}

// Which calendar we read from. Nexus can't know this — it's an app-level
// config. GOOGLE_CALENDAR_ID wins; otherwise we fall back to the caller's
// own email (owner-only rollout), which works because Google Calendar
// exposes each user's primary calendar under their email as the ID.
export function resolveCalendarId(userEmail) {
  return process.env.GOOGLE_CALENDAR_ID || userEmail || null;
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  if (creds.private_key_id) header.kid = creds.private_key_id;

  const claims = {
    iss: creds.client_email,
    scope: SCOPE,
    aud: creds.token_uri || TOKEN_URL_DEFAULT,
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(creds.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

async function mintAccessToken() {
  const creds = parseCredentials();
  const assertion = signJwt(creds);
  const tokenUrl = creds.token_uri || TOKEN_URL_DEFAULT;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `Service account token exchange failed: ${data.error || res.status} ${data.error_description || ''}`.trim()
    );
    err.statusCode = res.status;
    err.googleError = data.error;
    throw err;
  }
  if (!data.access_token) {
    throw new Error('Service account token exchange returned no access_token');
  }

  return {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

export async function getServiceAccountAccessToken() {
  if (cachedToken && cachedTokenExpiresAt - Date.now() > EXPIRY_SAFETY_MARGIN_MS) {
    return cachedToken;
  }
  const { accessToken, expiresAtMs } = await mintAccessToken();
  cachedToken = accessToken;
  cachedTokenExpiresAt = expiresAtMs;
  return accessToken;
}

export async function listEventsSA({
  calendarId,
  timeMin,
  timeMax,
  timeZone,
  maxResults = 250,
}) {
  if (!calendarId) throw new Error('listEventsSA: calendarId required');
  const accessToken = await getServiceAccountAccessToken();
  const toISO = (v) => (v instanceof Date ? v.toISOString() : v);

  const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('timeMin', toISO(timeMin));
  url.searchParams.set('timeMax', toISO(timeMax));
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', String(maxResults));
  if (timeZone) url.searchParams.set('timeZone', timeZone);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch {}
    const err = new Error(
      `Google Calendar API ${res.status}: ${body?.error?.message || res.statusText}`
    );
    err.statusCode = res.status;
    err.googleError = body?.error;
    // 404 on the calendar ID means the user hasn't shared their calendar
    // with the SA yet — surface that distinctly so the UI can explain.
    if (res.status === 404) err.notShared = true;
    throw err;
  }
  const data = await res.json();
  return data.items || [];
}

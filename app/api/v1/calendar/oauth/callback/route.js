// ── GET /api/v1/calendar/oauth/callback ─────────────────────────────────────
// Google redirects here after the user approves (or denies) the consent
// screen. This is a top-level browser navigation, so we cannot rely on
// the normal bearer-token middleware — instead, we authenticate the
// request via the `state` JWT that we signed on /oauth/start.
//
// IMPORTANT: This path must be listed in middleware.js's bypass list.
//
// Flow:
//   1. Google appends ?code=<auth>&state=<jwt>  (or ?error=access_denied)
//   2. We verify the state JWT — gives us the user's email.
//   3. We exchange the auth code for tokens.
//   4. We fetch the Google userinfo so we can store google_email.
//   5. We encrypt + persist to calendar_tokens.
//   6. We redirect the browser back to the app with a success/error flag.
//
// On any failure we redirect to `/?calendar=error&reason=<slug>` so the
// front-end can show a toast. Rendering a JSON error here would leave the
// user staring at a raw response with no way back to the app.

import { NextResponse } from 'next/server';
import { verifyState } from '../../../../../../src/lib/oauth-state';
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  REQUIRED_SCOPES,
} from '../../../../../../src/lib/google-calendar';
import { upsertTokens } from '../../../../../../src/lib/calendar-token-store';

function getAppBaseUrl(req) {
  // Prefer explicit env config; fall back to the request's origin so
  // local dev + preview environments Just Work without touching env vars.
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '');
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  try {
    return new URL(req.url).origin;
  } catch {
    return '';
  }
}

function redirectToApp(base, params) {
  // Land back on the calendar tab with a status query string. Using the
  // hash-free `/?tab=calendar&calendar=<status>` format — CalendarView will
  // read the query string on mount.
  const search = new URLSearchParams(params);
  const url = `${base}/?tab=calendar&${search.toString()}`;
  return NextResponse.redirect(url, { status: 302 });
}

export async function GET(req) {
  const base = getAppBaseUrl(req);
  const url = new URL(req.url);

  // ── 1. Handle user-denied / error from Google ─────────────────────────
  const googleError = url.searchParams.get('error');
  if (googleError) {
    console.warn('[calendar/oauth/callback] Google returned error:', googleError);
    return redirectToApp(base, { calendar: 'error', reason: googleError });
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return redirectToApp(base, { calendar: 'error', reason: 'missing-params' });
  }

  // ── 2. Verify state JWT ────────────────────────────────────────────────
  const verified = verifyState(state);
  if (!verified) {
    console.warn('[calendar/oauth/callback] Invalid or expired state');
    return redirectToApp(base, { calendar: 'error', reason: 'invalid-state' });
  }
  const userEmail = verified.email;

  // ── 3. Exchange code for tokens ────────────────────────────────────────
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    console.error('[calendar/oauth/callback] Token exchange failed:', err.message);
    return redirectToApp(base, {
      calendar: 'error',
      reason: err.googleError || 'token-exchange',
    });
  }

  // ── 4. Verify scopes include calendar.readonly ─────────────────────────
  // Google sometimes returns a superset of what we asked for (if the user
  // had other scopes granted), but NEVER silently drops the requested
  // scope. Still, defend against misconfiguration.
  const grantedScopes = (tokens.scope || '').split(' ');
  const missing = REQUIRED_SCOPES.filter(
    (s) => s.includes('calendar') && !grantedScopes.includes(s)
  );
  if (missing.length > 0) {
    console.warn('[calendar/oauth/callback] Missing required scopes:', missing);
    return redirectToApp(base, { calendar: 'error', reason: 'missing-scopes' });
  }

  // ── 5. Fetch Google account identity ───────────────────────────────────
  let googleEmail = null;
  try {
    const userInfo = await fetchUserInfo(tokens.access_token);
    googleEmail = (userInfo.email || '').toLowerCase() || null;
  } catch (err) {
    // Not fatal — we can still store the tokens and show "connected"
    // without knowing which Google account it was.
    console.warn('[calendar/oauth/callback] userinfo failed:', err.message);
  }

  // ── 6. Persist tokens (encrypted) ──────────────────────────────────────
  try {
    await upsertTokens({
      userEmail,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: tokens.expires_at_ms,
      scopes: tokens.scope || REQUIRED_SCOPES.join(' '),
      calendarId: 'primary',
      googleEmail,
    });
  } catch (err) {
    console.error('[calendar/oauth/callback] DB persist failed:', err.message);
    return redirectToApp(base, { calendar: 'error', reason: 'persist' });
  }

  return redirectToApp(base, { calendar: 'connected' });
}

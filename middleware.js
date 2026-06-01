// ── Next.js Edge Middleware — JWT auth gate for /api/v1/* ──────────────────────
// Runs in Edge Runtime (no Node.js crypto). Uses Web Crypto API (crypto.subtle).

import { NextResponse } from 'next/server';

const SIGNING_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET must be set in production'); })() : 'ops-hub-dev-secret-DO-NOT-USE-IN-PRODUCTION');

// ── Base64url helpers (Edge-compatible, no Buffer) ────────────────────────────

function base64urlEncode(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToUint8Array(str) {
  // Restore standard base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Import HMAC key once (cached per isolate) ─────────────────────────────────

let cachedKey = null;

async function getKey() {
  if (cachedKey) return cachedKey;
  const enc = new TextEncoder();
  cachedKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return cachedKey;
}

// ── Verify JWT (HS256) using Web Crypto ───────────────────────────────────────

async function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const key = await getKey();
    const enc = new TextEncoder();
    const data = enc.encode(`${parts[0]}.${parts[1]}`);

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, data);
    const expectedSig = base64urlEncode(signatureBuffer);

    // Constant-time-ish comparison (both are base64url strings of equal length
    // for valid tokens; fall back to simple compare — Edge has no timingSafeEqual)
    if (expectedSig.length !== parts[2].length) return null;
    let mismatch = 0;
    for (let i = 0; i < expectedSig.length; i++) {
      mismatch |= expectedSig.charCodeAt(i) ^ parts[2].charCodeAt(i);
    }
    if (mismatch !== 0) return null;

    // Decode payload
    const payloadJson = new TextDecoder().decode(base64urlToUint8Array(parts[1]));
    const payload = JSON.parse(payloadJson);

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── Origin guard for state-changing requests ─────────────────────────────────
// Defense-in-depth against CSRF: a stolen JWT on a user's machine cannot be
// weaponised from a third-party site because cross-origin POST/PUT/PATCH/DELETE
// requests are rejected before the token is even verified.
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Hardcoded fallback allowlist for the project's public-facing hostnames.
// Mirrors helm/values.yaml `ingress.host` (canonical) + `ingress.aliasHost`
// (the user-facing alias). The proxy chain forwards Host as the canonical,
// so without this list the user's browser Origin (`https://jtk.dp.com`,
// the alias) doesn't appear in any auto-derived source — every same-origin
// state-changing request gets flagged in observe mode (and would 403 if
// ORIGIN_CHECK_ENFORCE were ever flipped).
//
// In production we read these from ALLOWED_ORIGINS / NEXT_PUBLIC_APP_URL
// when the env vars are set, but neither is wired in this deployment, so
// keep the literal list in sync with helm/values.yaml until the env path
// is configured. New aliases → add them here AND, when convenient,
// migrate to env-var-driven config.
const KNOWN_PUBLIC_ORIGINS = [
  'https://jtk.dp.com',                  // ingress.aliasHost
  'https://jtk-ops-hub-v2.dp.com',       // ingress.host (canonical)
];

function isOriginAllowed(request) {
  if (!STATE_CHANGING.has(request.method)) return true;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  let candidate = origin;
  if (!candidate && referer) {
    try { candidate = new URL(referer).origin; } catch { /* ignore */ }
  }

  if (!candidate) {
    return process.env.ORIGIN_CHECK_ALLOW_MISSING === '1';
  }

  const allowed = new Set();
  if (process.env.ALLOWED_ORIGINS) {
    for (const raw of process.env.ALLOWED_ORIGINS.split(',')) {
      try { allowed.add(new URL(raw.trim()).origin); } catch {}
    }
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try { allowed.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin); } catch {}
  }
  try { allowed.add(new URL(request.url).origin); } catch {}

  // Behind an ingress / reverse proxy, request.url carries the in-pod origin
  // (http://localhost:3000) rather than the public-facing origin. The proxy
  // forwards the real host via x-forwarded-host (+ x-forwarded-proto), and
  // the same value lands in the Host header. Treat both as authoritative
  // so same-origin POSTs from the public URL pass without forcing every
  // deployment to wire up ALLOWED_ORIGINS / NEXT_PUBLIC_APP_URL.
  const fwdProto = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  const fwdHost  = (request.headers.get('x-forwarded-host')  || '').split(',')[0].trim();
  const host     = request.headers.get('host') || '';
  const proto    = fwdProto || 'https';
  if (fwdHost) { try { allowed.add(new URL(`${proto}://${fwdHost}`).origin); } catch {} }
  if (host)    { try { allowed.add(new URL(`${proto}://${host}`).origin); } catch {} }

  // Add the project's known public hostnames as a fallback. Covers the
  // ingress alias case (canonical in Host header, alias in browser Origin).
  for (const o of KNOWN_PUBLIC_ORIGINS) {
    try { allowed.add(new URL(o).origin); } catch {}
  }

  return allowed.has(candidate);
}

// ── Middleware function ───────────────────────────────────────────────────────

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // CSRF / origin guard — applied to every /api/v1/* mutation before we even
  // look at auth. Read-only GET/HEAD/OPTIONS are unaffected.
  //
  // Rollout safety: defaults to OBSERVE mode — we log would-be rejections so
  // ops can confirm ALLOWED_ORIGINS / NEXT_PUBLIC_APP_URL are configured
  // correctly before flipping to enforce. Set ORIGIN_CHECK_ENFORCE=1 once
  // logs are clean. This avoids a "the whole app is 403 the moment the pod
  // starts" failure mode if env is misconfigured.
  if (!isOriginAllowed(request)) {
    if (process.env.ORIGIN_CHECK_ENFORCE === '1') {
      return NextResponse.json({ error: 'Forbidden', reason: 'origin' }, { status: 403 });
    }
    console.warn(`[middleware] origin-check would reject: method=${request.method} path=${pathname} origin=${request.headers.get('origin') || 'none'} referer=${request.headers.get('referer') || 'none'}`);
  }

  // Skip auth for auth routes, config, and integration status endpoint.
  // The Google Calendar OAuth callback is also bypassed here because it's
  // hit as a top-level browser redirect from Google's consent screen — no
  // bearer token is available at that point. The callback itself
  // authenticates via the signed `state` JWT (see src/lib/oauth-state.js).
  //
  // EXCEPTION: /api/v1/auth/heartbeat needs the Bearer token to identify
  // the user whose last_seen_at to bump. It lives under the /api/v1/auth
  // prefix only because every other auth-related route does, but it is
  // an authenticated endpoint and MUST go through the JWT verification
  // below — otherwise getAuthUser() reads no x-user-* headers and the
  // route returns 401 for every call. (Caught 2026-05-08: the column
  // had been showing last_login_at across the board because zero
  // heartbeats were ever landing.)
  if (
    (pathname.startsWith('/api/v1/auth') && pathname !== '/api/v1/auth/heartbeat') ||
    pathname === '/api/v1/config' ||
    pathname === '/api/v1/version' ||
    pathname === '/api/v1/integrations/status' ||
    pathname === '/api/v1/calendar/oauth/callback' ||
    // Phase 4 of HANDOVERS_PLAN.md — the handover cron endpoints
    // authenticate via CRON_SECRET (shared bearer), not JWT. The
    // k8s CronJob (helm/templates/cronjob-handovers.yaml) attaches
    // the secret on the Authorization header but it isn't a JWT, so
    // the standard middleware verification below would reject it.
    // Bypassing here lets verifyCronSecret() in the route handle
    // the check + return the right status (403 on bad token,
    // 503 on missing env var).
    pathname.startsWith('/api/v1/handovers/cron/')
  ) {
    return NextResponse.next();
  }

  // Extract Bearer token
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Forward user claims to route handlers via headers
  const requestHeaders = new Headers(request.headers);
  // Preserve a numeric `0` sub. Users seeded only in team_member_overrides
  // (no `members` row yet — common after the 2026-05-06 recovery) sign in
  // with `sub: 0`. The previous `payload.sub || ''` coerced 0 to empty
  // string, downstream `requireRole` then read x-user-id as null and
  // returned 401 'Unauthorized' to a perfectly valid admin/RM session.
  requestHeaders.set('x-user-id', payload.sub != null ? String(payload.sub) : '');
  requestHeaders.set('x-user-email', payload.email || '');
  requestHeaders.set('x-user-role', payload.role || '');
  // HTTP header values are ByteStrings (Latin-1 only, codepoints 0-255).
  // A display name with a non-Latin-1 character — e.g. Polish `Ś`
  // (U+015A, decimal 346) — throws `TypeError: Cannot convert argument
  // to a ByteString…` and locks the user out of every API call. URL-
  // encode the name here; auth-helpers.js#getAuthUser decodes it on
  // the route side. Encoding is a no-op for ASCII-only names so existing
  // users see no change. (Caught 2026-06-01: prod logs showed the error
  // every few seconds — every HRX member with a Polish / Czech / other
  // non-Latin-1 surname was effectively offline.)
  requestHeaders.set('x-user-name', encodeURIComponent(payload.name || ''));

  // Impersonation propagation. The FE Login-as feature lets admins / RMs
  // view the app as another user — but until 2026-05-03 the swap was
  // FE-only, so every API call still ran with the impersonator's email.
  // The agent audit (A-F17 / A-F19 / A-F22) caught this surfacing as
  // "My Requests" showing the admin's data while impersonating Will, and
  // votes failing because the token email didn't match the rendered user.
  //
  // Now: if the caller has an admin or regional-manager JWT AND sends
  // `X-Impersonate-As: <email>`, the downstream `x-user-*` headers reflect
  // the impersonated identity. Non-privileged callers (agents, TLs) cannot
  // self-impersonate — the header is ignored unless the JWT role allows it.
  // We pass-through the original impersonator email/role on
  // `x-impersonator-email` / `x-impersonator-role` so audit-log writes can
  // still attribute actions to the human pressing the button.
  const impersonateAs = request.headers.get('x-impersonate-as');
  if (impersonateAs) {
    const role = String(payload.role || '').toLowerCase();
    if (role === 'admin' || role === 'regional_manager') {
      requestHeaders.set('x-impersonator-email', payload.email || '');
      requestHeaders.set('x-impersonator-role', payload.role || '');
      requestHeaders.set('x-user-email', String(impersonateAs).toLowerCase());
      // Keep x-user-id / x-user-name on the JWT issuer; routes that need
      // the impersonated id can resolve it from the email via the team
      // directory. Most routes only care about email which is the natural
      // identity key per skill mistake #4.
    }
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: '/api/v1/:path*',
};

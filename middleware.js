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

function isOriginAllowed(request) {
  if (!STATE_CHANGING.has(request.method)) return true;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  let candidate = origin;
  if (!candidate && referer) {
    try { candidate = new URL(referer).origin; } catch { /* ignore */ }
  }

  if (!candidate) {
    // Allow only via explicit opt-in (server-to-server cron, etc.).
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
  if (
    pathname.startsWith('/api/v1/auth') ||
    pathname === '/api/v1/config' ||
    pathname === '/api/v1/version' ||
    pathname === '/api/v1/integrations/status' ||
    pathname === '/api/v1/calendar/oauth/callback'
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
  requestHeaders.set('x-user-id', String(payload.sub || ''));
  requestHeaders.set('x-user-email', payload.email || '');
  requestHeaders.set('x-user-role', payload.role || '');
  requestHeaders.set('x-user-name', payload.name || '');

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: '/api/v1/:path*',
};

// ── Next.js Edge Middleware — JWT auth gate for /api/v1/* ──────────────────────
// Runs in Edge Runtime (no Node.js crypto). Uses Web Crypto API (crypto.subtle).

import { NextResponse } from 'next/server';

const SIGNING_SECRET = process.env.JWT_SECRET || 'ops-hub-dev-secret-DO-NOT-USE-IN-PRODUCTION';

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

// ── Middleware function ───────────────────────────────────────────────────────

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Skip auth for auth routes, config, and integration status endpoint
  if (pathname.startsWith('/api/v1/auth') || pathname === '/api/v1/config' || pathname === '/api/v1/integrations/status' || pathname === '/api/v1/integrations/test') {
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

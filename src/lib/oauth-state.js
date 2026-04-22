// ── OAuth state parameter — signed CSRF token for the OAuth round-trip ──────
// Google OAuth's `state` param is our CSRF defence: we embed the initiating
// user's email in a signed token, hand it to Google, and Google echoes it
// back on the callback. If an attacker tries to trick a victim into hitting
// our /callback with a Google code that belongs to the attacker's Google
// account, the state token either:
//   1. Is missing / tampered → signature check fails, we reject.
//   2. Is expired (>5 min old) → expiry check fails, we reject.
//   3. Is the attacker's own state → email in state ≠ victim's session email,
//      we reject in the route handler.
//
// Why a separate module (not `src/lib/jwt.js`):
//   • Purpose isolation: these tokens embed `purpose: 'calendar-oauth'`.
//     If someone steals a session JWT they still can't use it as a state
//     param (the callback rejects any token whose `purpose` ≠ 'calendar-
//     oauth'), and vice versa. Belt-and-braces defence in depth.
//   • Different TTL. Session JWTs live 24 h; a state token only needs to
//     survive the user clicking "Allow" on Google's consent screen —
//     5 min is the ceiling, typically completes in <30 s.
//
// Same signing key (JWT_SECRET) as session tokens — the purpose claim is
// what prevents cross-use, not separate keys. One secret is simpler to
// rotate and matches how the rest of the app treats signing material.

import crypto from 'crypto';

const ALGORITHM = 'HS256';
const STATE_TTL_SECONDS = 5 * 60;     // 5 minutes; consent flow shouldn't take longer
const PURPOSE = 'calendar-oauth';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Mirror src/lib/jwt.js behaviour: warn (don't throw) so Next.js build
    // doesn't fail, but the dev fallback is clearly marked as unsafe.
    console.warn('[SECURITY WARNING] JWT_SECRET not set — oauth-state using insecure default. Set JWT_SECRET in production!');
    return 'ops-hub-dev-secret-DO-NOT-USE-IN-PRODUCTION';
  }
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function base64urlDecode(input) {
  return Buffer.from(input, 'base64url').toString();
}

/**
 * Issue a signed OAuth state token for the given user email.
 *
 * The token is a compact JWT: header.payload.sig, base64url-encoded. Payload
 * carries { email, purpose, nonce, iat, exp }. The nonce defends against
 * the unlikely case that two simultaneous connect attempts from the same
 * user would otherwise produce identical tokens (not strictly necessary for
 * CSRF, but it means each attempt has a unique fingerprint in logs).
 *
 * @param {string} email — the email of the user initiating the OAuth flow
 * @returns {string} signed state token to pass as `&state=` on the redirect
 */
export function signState(email) {
  if (!email || typeof email !== 'string') {
    throw new TypeError('signState: email must be a non-empty string');
  }

  const header = { alg: ALGORITHM, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    email,
    purpose: PURPOSE,
    nonce: crypto.randomBytes(8).toString('base64url'),
    iat: now,
    exp: now + STATE_TTL_SECONDS,
  };

  const segments = [
    base64url(JSON.stringify(header)),
    base64url(JSON.stringify(payload)),
  ];

  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(segments.join('.'))
    .digest('base64url');

  return [...segments, signature].join('.');
}

/**
 * Verify an OAuth state token and return its payload.
 *
 * Returns null on any failure — caller should treat null as "reject this
 * callback, it's either tampered, expired, or not a state token". We don't
 * throw different error types because the only correct response to any
 * verification failure is the same: 400 + generic message, don't leak
 * which check failed to a potential attacker.
 *
 * Checks in order:
 *   1. Structural — token splits into 3 parts.
 *   2. Signature — HMAC matches (timing-safe compare).
 *   3. Purpose — must be exactly 'calendar-oauth' (blocks session-JWT reuse).
 *   4. Expiry — exp claim is in the future.
 *   5. Email — present and non-empty.
 *
 * @param {string} token — the raw state value received on /callback
 * @returns {{ email: string, nonce: string, iat: number, exp: number } | null}
 */
export function verifyState(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const expected = crypto
      .createHmac('sha256', getSecret())
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');

    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(parts[2]);
    // Lengths must match before timingSafeEqual; otherwise it throws.
    if (expectedBuf.length !== actualBuf.length) return null;
    if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;

    const payload = JSON.parse(base64urlDecode(parts[1]));

    // Purpose check — prevents session tokens being swapped in as state.
    if (payload.purpose !== PURPOSE) return null;

    // Expiry.
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;

    // Sanity.
    if (!payload.email || typeof payload.email !== 'string') return null;

    return {
      email: payload.email,
      nonce: payload.nonce,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

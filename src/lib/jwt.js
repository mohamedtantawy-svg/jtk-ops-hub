// ── Lightweight JWT utility using Node.js crypto ─────────────────────────────
// Signs and verifies HS256 JWTs without external dependencies.

import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET || 'ops-hub-dev-secret-change-in-production';
const ALGORITHM = 'HS256';
const TOKEN_EXPIRY_HOURS = 24;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function base64urlDecode(input) {
  return Buffer.from(input, 'base64url').toString();
}

/**
 * Create a signed JWT token.
 * @param {object} payload — claims to include (email, id, role, etc.)
 * @returns {string} signed JWT
 */
export function signToken(payload) {
  const header = { alg: ALGORITHM, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const claims = {
    ...payload,
    iat: now,
    exp: now + TOKEN_EXPIRY_HOURS * 3600,
  };

  const segments = [
    base64url(JSON.stringify(header)),
    base64url(JSON.stringify(claims)),
  ];

  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(segments.join('.'))
    .digest('base64url');

  return [...segments, signature].join('.');
}

/**
 * Verify and decode a JWT token.
 * @param {string} token — the JWT string
 * @returns {object|null} decoded payload, or null if invalid/expired
 */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    // Verify signature
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(base64urlDecode(parts[1]));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

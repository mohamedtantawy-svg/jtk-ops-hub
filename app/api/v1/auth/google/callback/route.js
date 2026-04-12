// ── Google OAuth proxy callback handler ─────────────────────────────────────
// Receives user data from the platform proxy (login.dp.com) after it
// exchanged the Google auth code for tokens. Verifies domain, looks up
// the member in the database, and issues an app JWT.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { signToken } from '../../../../../../src/lib/jwt';

const ALLOWED_DOMAIN = 'deel.com';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

/**
 * If the proxy returns an access_token instead of user info,
 * fetch user info from Google's userinfo endpoint.
 */
async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Verify a Google ID token via the tokeninfo endpoint.
 */
async function verifyIdToken(idToken) {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) return null;
  const payload = await res.json();

  if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) {
    console.error('[auth/google/callback] Token audience mismatch:', payload.aud);
    return null;
  }
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    console.error('[auth/google/callback] Email not verified');
    return null;
  }
  return payload;
}

export async function POST(req) {
  try {
    const body = await req.json();

    let email = null;
    let name = null;
    let picture = null;

    // Case 1: Proxy sent an id_token
    if (body.id_token) {
      const verified = await verifyIdToken(body.id_token);
      if (!verified) {
        return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 });
      }
      email = verified.email?.toLowerCase();
      name = verified.name || `${verified.given_name || ''} ${verified.family_name || ''}`.trim();
      picture = verified.picture;
    }
    // Case 2: Proxy sent an access_token
    else if (body.access_token) {
      const userInfo = await fetchGoogleUserInfo(body.access_token);
      if (!userInfo?.email) {
        return NextResponse.json({ error: 'Failed to fetch Google user info' }, { status: 401 });
      }
      email = userInfo.email.toLowerCase();
      name = userInfo.name || '';
      picture = userInfo.picture;
    }
    // Case 3: Proxy sent user info directly (email, name, etc.)
    else if (body.email) {
      email = body.email.toLowerCase();
      name = body.name || '';
      picture = body.picture || '';
    }
    else {
      return NextResponse.json(
        { error: 'No authentication data received' },
        { status: 400 }
      );
    }

    // Enforce domain restriction
    const domain = email.split('@')[1];
    if (domain !== ALLOWED_DOMAIN) {
      return NextResponse.json(
        { error: `Only @${ALLOWED_DOMAIN} accounts are allowed` },
        { status: 403 }
      );
    }

    // Look up user in members table
    const { rows } = await query(
      'SELECT * FROM members WHERE email = $1 AND is_active = true',
      [email]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No Ops Hub account found. Contact your admin for access.' },
        { status: 404 }
      );
    }

    const user = rows[0];

    // Issue signed JWT
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    return NextResponse.json({ token, user });
  } catch (err) {
    console.error('[auth/google/callback]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

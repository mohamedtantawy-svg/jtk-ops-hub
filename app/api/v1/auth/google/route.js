// ── Google OAuth token exchange endpoint ──────────────────────────────────────
// Receives a Google ID token credential from the frontend, verifies it
// server-side via Google's tokeninfo API, and issues a signed app JWT.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { signToken } from '../../../../../src/lib/jwt';

const ALLOWED_DOMAIN = 'deel.com';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

/**
 * Verify Google ID token using Google's tokeninfo endpoint.
 * Returns the decoded token payload, or null on failure.
 */
async function verifyGoogleToken(credential) {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;

    const payload = await res.json();

    // Verify audience matches our client ID
    if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) {
      console.error('[auth/google] Token audience mismatch:', payload.aud);
      return null;
    }

    // Verify email is verified
    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      console.error('[auth/google] Email not verified');
      return null;
    }

    return payload;
  } catch (err) {
    console.error('[auth/google] Token verification failed:', err.message);
    return null;
  }
}

export async function POST(req) {
  try {
    const { credential } = await req.json();
    if (!credential) {
      return NextResponse.json({ error: 'Google credential required' }, { status: 400 });
    }

    // 1. Verify the Google token server-side
    const googleUser = await verifyGoogleToken(credential);
    if (!googleUser) {
      return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 });
    }

    const email = googleUser.email?.toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'No email in Google token' }, { status: 400 });
    }

    // 2. Enforce domain restriction
    const domain = email.split('@')[1];
    if (domain !== ALLOWED_DOMAIN) {
      return NextResponse.json(
        { error: `Only @${ALLOWED_DOMAIN} accounts are allowed` },
        { status: 403 }
      );
    }

    // 3. Look up user in members table
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

    // 4. Issue signed JWT
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    return NextResponse.json({ token, user });
  } catch (err) {
    console.error('[auth/google]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

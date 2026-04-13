// ── Google OAuth proxy callback handler ─────────────────────────────────────
// Receives user data from the platform proxy (login.dp.com) after it
// exchanged the Google auth code for tokens. Verifies domain, looks up
// the member in the database (if available), and issues an app JWT.

import { NextResponse } from 'next/server';
import { signToken } from '../../../../../../src/lib/jwt';
import { ADMIN_EMAILS } from '../../../../../../src/data/adminEmails';

const ALLOWED_DOMAIN = 'deel.com';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

/**
 * If the proxy returns an access_token, fetch user info from Google.
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

/**
 * Try to look up the user in the database. Returns null if DB is unavailable.
 */
async function findMemberByEmail(email) {
  try {
    if (!process.env.DATABASE_URL) return null;
    const { query } = await import('../../../../../../src/lib/db');
    const { rows } = await query(
      'SELECT * FROM members WHERE email = $1 AND is_active = true',
      [email]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.warn('[auth/google/callback] DB lookup failed, proceeding without DB:', err.message);
    return null;
  }
}

export async function POST(req) {
  try {
    const body = await req.json();

    // Log what the proxy sent (keys only, not values, for security)
    console.log('[auth/google/callback] Received keys:', Object.keys(body));

    let email = null;
    let name = null;
    let picture = null;

    // ── Strategy 0: Platform proxy (login.dp.com) sends gcp_* keys ────
    if (body.gcp_id_token || body.gcp_user_email) {
      // Try verifying the GCP id_token first for strongest auth
      if (body.gcp_id_token) {
        const verified = await verifyIdToken(body.gcp_id_token);
        if (verified) {
          email = verified.email?.toLowerCase();
          name = verified.name || `${verified.given_name || ''} ${verified.family_name || ''}`.trim();
          picture = verified.picture;
        }
      }
      // If id_token verification failed or wasn't present, try access_token
      if (!email && body.gcp_access_token) {
        const userInfo = await fetchGoogleUserInfo(body.gcp_access_token);
        if (userInfo?.email) {
          email = userInfo.email.toLowerCase();
          name = userInfo.name || '';
          picture = userInfo.picture;
        }
      }
      // Fall back to the direct user info from proxy
      if (!email && body.gcp_user_email) {
        email = body.gcp_user_email.toLowerCase();
        name = body.gcp_user_name || '';
        picture = body.gcp_user_picture || '';
      }
    }
    // ── Strategy 1: Proxy sent an id_token ──────────────────────────────
    else if (body.id_token) {
      const verified = await verifyIdToken(body.id_token);
      if (!verified) {
        return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 });
      }
      email = verified.email?.toLowerCase();
      name = verified.name || `${verified.given_name || ''} ${verified.family_name || ''}`.trim();
      picture = verified.picture;
    }
    // ── Strategy 2: Proxy sent an access_token ──────────────────────────
    else if (body.access_token) {
      const userInfo = await fetchGoogleUserInfo(body.access_token);
      if (!userInfo?.email) {
        return NextResponse.json({ error: 'Failed to fetch Google user info' }, { status: 401 });
      }
      email = userInfo.email.toLowerCase();
      name = userInfo.name || '';
      picture = userInfo.picture;
    }
    // ── Strategy 3: Proxy sent email directly (common for platform proxies)
    else if (body.email) {
      email = body.email.toLowerCase();
      name = body.name || body.displayName || body.given_name || '';
      picture = body.picture || body.photo || '';
    }
    // ── Strategy 4: Proxy sent a credential (Google One Tap style) ──────
    else if (body.credential) {
      const verified = await verifyIdToken(body.credential);
      if (!verified) {
        return NextResponse.json({ error: 'Invalid Google credential' }, { status: 401 });
      }
      email = verified.email?.toLowerCase();
      name = verified.name || `${verified.given_name || ''} ${verified.family_name || ''}`.trim();
      picture = verified.picture;
    }
    // ── Strategy 5: Proxy sent a token field ────────────────────────────
    else if (body.token) {
      // Some proxies use generic "token" key for id_token
      const verified = await verifyIdToken(body.token);
      if (verified) {
        email = verified.email?.toLowerCase();
        name = verified.name || `${verified.given_name || ''} ${verified.family_name || ''}`.trim();
        picture = verified.picture;
      } else {
        // Try as access_token
        const userInfo = await fetchGoogleUserInfo(body.token);
        if (userInfo?.email) {
          email = userInfo.email.toLowerCase();
          name = userInfo.name || '';
          picture = userInfo.picture;
        }
      }
    }

    // ── If no strategy worked, return a helpful debug error ─────────────
    if (!email) {
      console.error('[auth/google/callback] Could not extract email. Body keys:', Object.keys(body));
      console.error('[auth/google/callback] Body values (first 100 chars each):',
        Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v).substring(0, 100)]))
      );
      return NextResponse.json(
        {
          error: 'No valid authentication token received. Please sign in with Google.',
          debug_keys: Object.keys(body),
        },
        { status: 400 }
      );
    }

    // ── Enforce @deel.com domain restriction ────────────────────────────
    const domain = email.split('@')[1];
    if (domain !== ALLOWED_DOMAIN) {
      console.warn('[auth/google/callback] Rejected domain:', domain);
      return NextResponse.json(
        { error: 'Only @deel.com accounts are allowed. Please contact your admin for access.' },
        { status: 403 }
      );
    }

    // Only allow users in the admin allowlist (or DB if available)
    if (!ADMIN_EMAILS.has(email) && !process.env.DATABASE_URL) {
      console.warn('[auth/google/callback] User not in allowlist:', email);
      return NextResponse.json(
        { error: 'You do not have access to Ops Hub. Please contact your admin.' },
        { status: 403 }
      );
    }

    // ── Check if user is in the admin allowlist ──────────────────────────
    const isAdmin = ADMIN_EMAILS.has(email);

    // ── Look up user in database (graceful fallback if DB unavailable) ──
    const dbUser = await findMemberByEmail(email);

    // Build user object — prefer DB data, fall back to Google profile
    const user = dbUser || {
      id: 0,
      email,
      name: name || email.split('@')[0],
      role: isAdmin ? 'admin' : 'member',
      team: 'JTK',
    };

    // If DB user exists but is in the admin allowlist, ensure admin role
    if (dbUser && isAdmin && dbUser.role !== 'admin') {
      user.role = 'admin';
    }

    // ── Issue signed JWT ────────────────────────────────────────────────
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    return NextResponse.json({ token, user });
  } catch (err) {
    console.error('[auth/google/callback] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

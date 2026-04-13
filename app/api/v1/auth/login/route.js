// ── Email login endpoint ─────────────────────────────────────────────────────
// Validates @deel.com domain, looks up active member in DB, issues JWT.
// This is a convenience login for the internal HR tool. Google SSO is preferred.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { signToken } from '../../../../../src/lib/jwt';

const ALLOWED_DOMAIN = 'deel.com';

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const trimmed = email.trim().toLowerCase();

    // Domain restriction
    const domain = trimmed.split('@')[1];
    if (domain !== ALLOWED_DOMAIN) {
      return NextResponse.json(
        { error: `Only @${ALLOWED_DOMAIN} accounts are allowed` },
        { status: 403 }
      );
    }

    // Look up active member in database
    const { rows } = await query(
      'SELECT id, email, name, role FROM members WHERE email = $1 AND is_active = true',
      [trimmed]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No active account found for this email. Contact your admin for access.' },
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
    console.error('[auth/login]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

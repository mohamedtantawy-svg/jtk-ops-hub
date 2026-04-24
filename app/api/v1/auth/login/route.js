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

    let user = rows[0];

    // Fallback: accept users recorded only in team_member_overrides (new hires
    // added via the Team tab that don't yet have a members row). Without this
    // fallback, newly-added users cannot email-login.
    if (!user) {
      const { rows: ovRows } = await query(
        `SELECT email, name, access
           FROM team_member_overrides
          WHERE email = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
        [trimmed]
      );
      if (ovRows.length > 0) {
        const o = ovRows[0];
        user = { id: 0, email: o.email, name: o.name || trimmed, role: o.access || 'agent' };
      }
    }

    if (!user) {
      return NextResponse.json(
        { error: 'No active account found for this email. Contact your admin for access.' },
        { status: 404 }
      );
    }

    // Record login for the Team-tab last-login badge (best-effort)
    try {
      await query(
        `INSERT INTO team_member_overrides (email, last_login_at, login_count)
         VALUES ($1, NOW(), 1)
         ON CONFLICT (email) DO UPDATE
         SET last_login_at = NOW(),
             login_count   = team_member_overrides.login_count + 1,
             updated_at    = NOW()`,
        [trimmed]
      );
    } catch (err) {
      console.warn('[auth/login] recordLogin failed:', err.message);
    }

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

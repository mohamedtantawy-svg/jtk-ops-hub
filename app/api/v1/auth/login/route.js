import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { signToken } from '../../../../../src/lib/jwt';

const ALLOWED_DOMAIN = 'deel.com';

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

    const normalised = email.toLowerCase().trim();

    // Domain restriction
    const domain = normalised.split('@')[1];
    if (domain !== ALLOWED_DOMAIN) {
      return NextResponse.json(
        { error: `Only @${ALLOWED_DOMAIN} accounts are allowed` },
        { status: 403 }
      );
    }

    const { rows } = await query(
      'SELECT * FROM members WHERE email = $1 AND is_active = true',
      [normalised]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const user = rows[0];

    // Signed JWT token
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

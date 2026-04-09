import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

    const { rows } = await query('SELECT * FROM members WHERE email = $1 AND is_active = true', [email.toLowerCase()]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Simple token (in production, use JWT with proper signing)
    const token = Buffer.from(JSON.stringify({ email: rows[0].email, id: rows[0].id, ts: Date.now() })).toString('base64');

    return NextResponse.json({ token, user: rows[0] });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { verifyToken } from '../../../../src/lib/jwt';

function extractToken(req) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return verifyToken(auth.slice(7));
}

export async function GET(req) {
  try {
    const claims = extractToken(req);
    if (!claims?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { rows } = await query('SELECT * FROM members WHERE email = $1', [claims.email]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('[me]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

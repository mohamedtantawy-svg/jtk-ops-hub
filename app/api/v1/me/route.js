import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';

function parseToken(req) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return JSON.parse(Buffer.from(auth.slice(7), 'base64').toString());
  } catch { return null; }
}

export async function GET(req) {
  try {
    const token = parseToken(req);
    if (!token?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { rows } = await query('SELECT * FROM members WHERE email = $1', [token.email]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('[me]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

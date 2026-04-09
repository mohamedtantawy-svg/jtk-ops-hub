import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    // Mark as read — in a full implementation this would track per-user reads
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcements/read]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

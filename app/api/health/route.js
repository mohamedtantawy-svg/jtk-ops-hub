import { NextResponse } from 'next/server';
import { query } from '../../../src/lib/db';

export async function GET() {
  try {
    await query('SELECT 1');
    return NextResponse.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('[health] DB check failed:', err.message);
    return NextResponse.json(
      { status: 'degraded', db: 'disconnected' },
      { status: 503 }
    );
  }
}

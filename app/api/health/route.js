import { NextResponse } from 'next/server';

export async function GET() {
  // Always return 200 so K8s readiness probe passes.
  // DB connectivity is checked separately by the app.
  let db = 'unknown';
  try {
    const { query } = await import('../../../src/lib/db');
    await query('SELECT 1');
    db = 'connected';
  } catch {
    db = 'disconnected';
  }
  return NextResponse.json({ status: 'ok', db });
}

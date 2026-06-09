// ── /api/v1/cron/performance-cycle (Phase F, 2026-06-09) ───────────────────
// Mirrors /api/v1/cron/tasks-sla-sync. Two callers:
//   • Out-of-band Kubernetes CronJob / GitHub Action with a Bearer token
//     matching PERF_CYCLE_SYNC_TOKEN.
//   • Admin curl from a browser with an admin JWT (debug only; ?force=1 to
//     bypass the daily soft-TTL gate).
// The in-process scheduler in instrumentation.js runs the same sync directly
// (no HTTP roundtrip) every 6 h — the soft-TTL gate keeps it to once a day.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { runPerformanceCycleSync } from '../../../../../src/lib/performance-cycle-sync';

function bearerOk(req) {
  const expected = process.env.PERF_CYCLE_SYNC_TOKEN;
  if (!expected) return false;
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const token = auth.slice(7).trim();
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function adminOk(req) {
  const user = getAuthUser(req);
  return user.email && user.role === 'admin';
}

export async function POST(req) {
  const isBearer = bearerOk(req);
  const isAdmin = !isBearer && adminOk(req);
  if (!isBearer && !isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const force = isAdmin && url.searchParams.get('force') === '1';
  try {
    const result = await runPerformanceCycleSync({ force });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[performance-cycle route]', err?.message);
    return NextResponse.json({ error: 'Internal error', message: err?.message }, { status: 500 });
  }
}

// ── /api/v1/cron/tasks-sla-sync (Phase 3, 2026-05-25) ──────────────────────
// Mirrors /api/v1/cron/zendesk-sla-sync. Two callers:
//   • Out-of-band Kubernetes CronJob / GitHub Action with a Bearer token
//     matching TASKS_SLA_SYNC_TOKEN.
//   • Admin curl from a browser with an admin JWT (debug only).
//
// The in-process scheduler in instrumentation.js runs the same sync
// directly (no HTTP roundtrip needed) every hour.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { runTasksSlaSync } from '../../../../../src/lib/work-tasks-sla-sync';

function bearerOk(req) {
  const expected = process.env.TASKS_SLA_SYNC_TOKEN;
  if (!expected) return false;
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const token = auth.slice(7).trim();
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function adminOk(req) {
  const user = getAuthUser(req);
  return user.email && user.role === 'admin';
}

export async function POST(req) {
  const isBearer = bearerOk(req);
  const isAdmin = !isBearer && adminOk(req);
  if (!isBearer && !isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const force = isAdmin && url.searchParams.get('force') === '1';
  try {
    const result = await runTasksSlaSync({ force });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[tasks-sla-sync route]', err?.message);
    return NextResponse.json({ error: 'Internal error', message: err?.message }, { status: 500 });
  }
}

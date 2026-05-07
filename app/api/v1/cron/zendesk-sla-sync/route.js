import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { runZendeskSlaSync } from '../../../../../src/lib/zendesk-sla-sync';
import { query } from '../../../../../src/lib/db';

// Background SLA cache refresh — pulls Zendesk policy_metrics and writes
// per-ticket FRT/NRT breach times into `zendesk_ticket_sla`. Two callers:
//   • The in-process scheduler (instrumentation.js) — fires every 10 min
//     on the same pod. Already authenticated by being in-process.
//   • External schedulers (k8s CronJob, GitHub Actions, manual curl from
//     an admin) — must present either a Bearer token (matching the
//     ZD_SLA_SYNC_TOKEN env var) OR an admin JWT.
//
// The sync itself dedupes: a second hit within MIN_RESYNC_GAP_MS (5 min)
// returns `{ ran: false, reason: 'recent_sync' }` without touching
// Zendesk. Pass `?force=1` (admin only) to bypass the gap for debugging.

function bearerOk(req) {
  const expected = process.env.ZD_SLA_SYNC_TOKEN;
  if (!expected) return false;
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const token = auth.slice(7).trim();
  // Constant-time comparison to defang timing attacks. Length-mismatched
  // tokens fail fast on the first byte; same-length tokens compare full.
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
  const isAdmin  = !isBearer && adminOk(req);
  if (!isBearer && !isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // `force=1` only honoured for admin callers (humans debugging). External
  // schedulers should respect the gap so two cluster pods can't double-run.
  const url = new URL(req.url);
  const force = isAdmin && url.searchParams.get('force') === '1';

  try {
    const result = await runZendeskSlaSync({ force });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[zd-sla-sync] route error:', err?.message);
    return NextResponse.json({ error: 'sync_failed', message: err?.message || String(err) }, { status: 500 });
  }
}

// GET returns the last_run summary without triggering a sync. Useful for
// monitoring dashboards and admin UIs — same auth gate as POST so we
// don't leak op timing data publicly.
export async function GET(req) {
  if (!bearerOk(req) && !adminOk(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ lastRun: null, reason: 'database_not_configured' });
  }
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = 'zendesk_sla_sync_last_run'`,
    );
    const value = rows[0]?.value || null;
    // Cache freshness — count how many rows were synced in the last hour
    // so a monitor can alarm when the table goes stale.
    const { rows: stat } = await query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE fetched_at > NOW() - INTERVAL '1 hour')::int AS fresh
         FROM zendesk_ticket_sla`,
    );
    return NextResponse.json({
      lastRun: value,
      cacheRowsTotal: stat[0]?.total ?? 0,
      cacheRowsFreshLastHour: stat[0]?.fresh ?? 0,
    });
  } catch (err) {
    return NextResponse.json({ error: 'status_failed', message: err?.message || String(err) }, { status: 500 });
  }
}

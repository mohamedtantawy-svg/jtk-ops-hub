// ── POST /api/v1/auth/heartbeat ──────────────────────────────────────────
// Bumps `member_logins.last_seen_at` to NOW() for the authenticated user.
// Called by the FE useActivityHeartbeat hook every 60 s when:
//   • the user has interacted with the app in the last 90 s, AND
//   • the tab is currently visible (document.hidden === false)
// Idle tabs in the background never reach this route, so the badge
// reflects real activity and not "tab left open since this morning".
//
// This is intentionally a tiny, idempotent endpoint — one UPSERT keyed
// on the authed email. No body, no return shape worth speaking of, and
// the FE treats failures as silent (next tick retries). On a fresh
// install where member_logins.last_login_at hasn't been written yet
// (user hasn't gone through the dual-write login routes), the INSERT
// branch seeds last_login_at = NOW() too so the row is well-formed.
//
// Server timestamps only — we never trust a client-supplied "now". This
// also defeats clock-skew based spoofing of "I was active 3 hours ago".

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    // No DB — best-effort no-op so the FE doesn't retry-storm a misconfigured
    // env. 200 + ok=false signals "we received it, didn't persist".
    return NextResponse.json({ ok: false, reason: 'database_not_configured' });
  }
  const emailLc = String(user.email).toLowerCase();
  try {
    await query(
      `INSERT INTO member_logins (email, last_login_at, last_seen_at, login_count)
       VALUES ($1, NOW(), NOW(), 1)
       ON CONFLICT (email) DO UPDATE
       SET last_seen_at = NOW(),
           updated_at   = NOW()`,
      [emailLc],
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.warn('[auth/heartbeat] write failed:', err?.message);
    // Don't 500 — the FE retries on next tick anyway and an alarm-loop on
    // a transient DB blip just makes the symptoms worse.
    return NextResponse.json({ ok: false, reason: 'write_failed' }, { status: 200 });
  }
}

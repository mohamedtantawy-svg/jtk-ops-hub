// ── /api/v1/work-tasks/tour-status (2026-05-25) ────────────────────────────
// Tracks whether a user has seen the one-time Tasks onboarding tour.
//
// GET  — { seen: boolean, seenAt?: ISO }
// POST — marks the tour seen for the caller. Idempotent. Body is ignored
//        but the route accepts a JSON body for future extension
//        (e.g. last_step_completed).
//
// Storage: app_settings row keyed `tasks_tour_seen:<email>`. Same pattern
// as the PersonalChecklist migration sentinel -- cheap, no schema change,
// per-user.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';

function sentinelKeyFor(email) {
  return `tasks_tour_seen:${String(email || '').toLowerCase()}`;
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
      [sentinelKeyFor(user.email)],
    );
    if (rows.length === 0) {
      return NextResponse.json({ seen: false });
    }
    const value = rows[0].value || {};
    return NextResponse.json({ seen: true, seenAt: value.at || null });
  } catch (err) {
    console.warn('[work-tasks tour-status GET]', err?.message);
    // Fail closed -- if the lookup fails, pretend the user has seen the
    // tour so we don't accidentally re-show it after every reload.
    return NextResponse.json({ seen: true, seenAt: null, error: 'lookup_failed' });
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const email = String(user.email).toLowerCase();
  let body = null;
  try { body = await req.json(); } catch { /* body is optional */ }
  const lastStep = Number.isFinite(Number(body?.lastStep)) ? Number(body.lastStep) : null;

  try {
    await query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [
        sentinelKeyFor(email),
        JSON.stringify({
          at: new Date().toISOString(),
          lastStep,
        }),
        email,
      ],
    );
    return NextResponse.json({ seen: true });
  } catch (err) {
    console.warn('[work-tasks tour-status POST]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

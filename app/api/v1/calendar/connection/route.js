// ── /api/v1/calendar/connection — connection status + disconnect ────────────
// GET    → { connected, googleEmail, scopes, connectedAt, lastError }
// DELETE → revokes at Google (best-effort) + deletes the DB row.
//
// Used by the CalendarView on mount to decide whether to show the
// "Connect Google Calendar" prompt or the daily/monthly views.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import {
  getConnectionStatus,
  getTokens,
  deleteTokens,
} from '../../../../../src/lib/calendar-token-store';
import { revokeToken } from '../../../../../src/lib/google-calendar';

const OWNER_EMAIL = 'mohamed.tantawy@deel.com';

function ownerGate(user) {
  if (!user.email) return { ok: false, status: 401, error: 'Unauthorized' };
  if (user.email.toLowerCase() !== OWNER_EMAIL) {
    return { ok: false, status: 403, error: 'Calendar integration is in limited rollout' };
  }
  return { ok: true };
}

export async function GET(req) {
  const user = getAuthUser(req);
  const gate = ownerGate(user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const status = await getConnectionStatus(user.email);
    return NextResponse.json(status);
  } catch (err) {
    console.error('[calendar/connection][GET]', err.message);
    return NextResponse.json({ error: 'Failed to read connection status' }, { status: 500 });
  }
}

export async function DELETE(req) {
  const user = getAuthUser(req);
  const gate = ownerGate(user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    // Best-effort revoke with Google first. We use the refresh token because
    // revoking it invalidates every access token derived from it. Failure
    // here doesn't block local disconnect — the user experience needs to
    // succeed even if Google is down.
    const tokens = await getTokens(user.email).catch(() => null);
    if (tokens?.refreshToken) {
      await revokeToken(tokens.refreshToken);
    }

    await deleteTokens(user.email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[calendar/connection][DELETE]', err.message);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}

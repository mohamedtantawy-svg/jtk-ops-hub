// ── /api/v1/leader-alerts/settings ───────────────────────────────────────
// GET — read all settings keys (categories, statuses, notifications). Used
//       by the composer modal, list filter chips, and the Settings panel.
//
// PUT lives at /settings/[key]/route.js (Stage 5) — Alerts Admin only.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { readAllSettings } from '../../../../../src/lib/leader-alerts-helpers';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const settings = await readAllSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    console.error('[leader-alerts.settings.get]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

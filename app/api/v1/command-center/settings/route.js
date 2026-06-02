// ── /api/v1/command-center/settings ──────────────────────────────────────────
// GET: the exec-tunable Command Center knobs (health weights, SLA ageing days,
//      capacity bands, default volume window). Any Command Center viewer.
// PUT: update them — additionally requires admin / super-admin (it's global
//      exec config that changes every viewer's rollups).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canViewCommandCenter } from '../../../../../src/lib/command-center-access';
import { isGlobalSuperAdmin } from '../../../../../src/lib/dept-scope';
import { getCommandCenterSettings, setCommandCenterSettings } from '../../../../../src/lib/command-center-settings';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getCommandCenterSettings());
  } catch (err) {
    console.error('[command-center/settings GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PUT(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canViewCommandCenter(user, req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Tuning the global exec config is admin / super-admin only.
  if (!isGlobalSuperAdmin(user) && String(user.role || '').toLowerCase() !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    return NextResponse.json(await setCommandCenterSettings(body));
  } catch (err) {
    console.error('[command-center/settings PUT]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

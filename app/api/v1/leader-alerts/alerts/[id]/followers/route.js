// ── /api/v1/leader-alerts/alerts/[id]/followers ─────────────────────────
// POST   — current user follows OR mutes this alert (body `{ mute: true }`).
// DELETE — current user unfollows (or unmutes — same row, default mute=false).
//
// Mute keeps the row but flips `muted = true` so the FE can still show the
// alert in My-Alerts but suppress bell entries for status / comment events.
// Mention notifications still bypass mute by policy (see notification matrix).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../../src/lib/db';
import { setMute, removeFollower, writeLog } from '../../../../../../../src/lib/leader-alerts-helpers';

async function alertExists(id) {
  const { rowCount } = await query(`SELECT 1 FROM leader_alert WHERE id = $1`, [id]);
  return rowCount > 0;
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  if (!(await alertExists(id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let payload = {};
  try { payload = await req.json(); } catch {}
  const muted = payload.mute === true;

  try {
    await setMute(id, user.email, muted);
    writeLog(
      id,
      { email: user.email, name: user.name },
      muted ? 'thread_muted' : 'follower_added',
      null,
      { email: user.email.toLowerCase(), muted },
    ).catch(() => {});
    return NextResponse.json({ ok: true, muted });
  } catch (err) {
    console.error('[leader-alerts.follower.post]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  try {
    const removed = await removeFollower(id, user.email);
    writeLog(
      id,
      { email: user.email, name: user.name },
      removed ? 'follower_removed' : 'thread_unmuted',
      { email: user.email.toLowerCase() },
      null,
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[leader-alerts.follower.delete]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

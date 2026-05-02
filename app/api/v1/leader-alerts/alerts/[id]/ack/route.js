// ── /api/v1/leader-alerts/alerts/[id]/ack ────────────────────────────────
// POST   — current user acks the alert. Idempotent on (alert_id, email).
// DELETE — current user un-acks (lets people undo a misclick).
//
// Both routes write an audit log entry so the timeline shows who acked /
// un-acked when. No notification fan-out — UI just updates the count.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../../src/lib/roster-server';
import { memberByEmail, writeLog } from '../../../../../../../src/lib/leader-alerts-helpers';

export async function POST(_req, { params }) {
  const user = getAuthUser(_req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();
  const { id } = await params;

  try {
    const { rowCount: alertExists } = await query(`SELECT 1 FROM leader_alert WHERE id = $1`, [id]);
    if (alertExists === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const member = memberByEmail(user.email);
    const result = await query(
      `INSERT INTO leader_alert_ack (alert_id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (alert_id, email) DO NOTHING
       RETURNING created_at`,
      [id, user.email.toLowerCase(), member?.name || user.name || user.email],
    );

    if (result.rowCount > 0) {
      // Only log on first-ack per user; ON CONFLICT means a re-ack is a no-op.
      await writeLog(
        id,
        { email: user.email, name: member?.name || user.name },
        'ack_added',
        null,
        { acker: user.email.toLowerCase() },
      );
    }

    const { rows: countRow } = await query(
      `SELECT COUNT(*)::int AS ack_count FROM leader_alert_ack WHERE alert_id = $1`,
      [id],
    );
    return NextResponse.json({ ok: true, acked: true, ackCount: countRow[0].ack_count });
  } catch (err) {
    console.error('[leader-alerts.ack.post]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  const user = getAuthUser(_req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const result = await query(
      `DELETE FROM leader_alert_ack WHERE alert_id = $1 AND LOWER(email) = $2`,
      [id, user.email.toLowerCase()],
    );

    if (result.rowCount > 0) {
      await writeLog(
        id,
        { email: user.email, name: user.name },
        'ack_removed',
        { acker: user.email.toLowerCase() },
        null,
      );
    }

    const { rows: countRow } = await query(
      `SELECT COUNT(*)::int AS ack_count FROM leader_alert_ack WHERE alert_id = $1`,
      [id],
    );
    return NextResponse.json({ ok: true, acked: false, ackCount: countRow[0].ack_count });
  } catch (err) {
    console.error('[leader-alerts.ack.delete]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

// ── DELETE /api/v1/time-off-events/:id ─────────────────────────────────
// Manual removal of a time-off entry. Counterpart to the POST in
// ../route.js. Per Lucy's 2026-05-13 ask: when the auto-imported OOO is
// wrong, team members + managers need an inline way to drop the bad row.
//
// Permission model (canManageTimeOffFor):
//   • Agents      — own rows only
//   • Team Leads  — own + direct reports
//   • Regional Mgrs — own + full subtree
//   • Admin       — anyone
//
// Safety: if a non-terminal handover is attached we 409 — the user must
// cancel/complete the handover first via the existing flow. Letting a
// delete cascade through an active handover would silently un-notify
// coverers + leave the activity log claiming the OOO existed.
import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canManageTimeOffFor } from '../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  await ensureRosterHydrated();

  try {
    const { rows } = await query(
      `SELECT work_email FROM time_off_events WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Time-off entry not found' }, { status: 404 });
    }

    const workEmail = rows[0].work_email;
    if (!canManageTimeOffFor(user, workEmail)) {
      return NextResponse.json(
        { error: 'You can only delete time off for yourself or your direct reports.' },
        { status: 403 },
      );
    }

    const { rows: hRows } = await query(
      `SELECT id FROM handovers
        WHERE time_off_event_id = $1
          AND status NOT IN ('cancelled','rejected','expired','completed')
        LIMIT 1`,
      [id],
    );
    if (hRows.length > 0) {
      return NextResponse.json(
        { error: 'Cancel the attached handover first before deleting this OOO entry.' },
        { status: 409 },
      );
    }

    await query(`DELETE FROM time_off_events WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[time-off-events DELETE]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

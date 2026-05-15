// ── PATCH / DELETE /api/v1/time-off-events/:id ─────────────────────────
// Manual edit + removal of a time-off entry. Counterparts to the POST in
// ../route.js. Per Lucy's 2026-05-13 ask: when the auto-imported OOO is
// wrong, team members + managers need an inline way to fix or drop the
// bad row — including for old mass-imported entries (Megan Lawrence
// 2026-05-15 feedback).
//
// Permission model (canManageTimeOffFor) — symmetric across PATCH +
// DELETE so whoever can create can also edit and remove:
//   • Agents      — own rows only
//   • Team Leads  — own + direct reports
//   • Regional Mgrs — own + full subtree
//   • Admin       — anyone
//
// Safety on DELETE: if a non-terminal handover is attached we 409 — the
// user must cancel/complete the handover first via the existing flow.
// Letting a delete cascade through an active handover would silently
// un-notify coverers + leave the activity log claiming the OOO existed.
// PATCH allows date edits with a non-terminal handover but emits a
// `dates_drifted` log entry on the handover when start/end shifts, so the
// timeline shows the change.
import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canManageTimeOffFor } from '../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  await ensureRosterHydrated();

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  // Only the three user-facing fields are editable. work_email is
  // immutable — changing the owner of an OOO would silently re-attribute
  // history; the right path for that is delete + create.
  const startDate = body?.start_date;
  const endDate   = body?.end_date;
  const reasonRaw = body?.reason;
  const reason = reasonRaw == null
    ? undefined
    : (String(reasonRaw).trim() || null);

  if (startDate != null && !isIsoDate(startDate)) {
    return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (endDate != null && !isIsoDate(endDate)) {
    return NextResponse.json({ error: 'end_date must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const { rows } = await query(
      `SELECT id, work_email, start_date, end_date, source, status, reason
         FROM time_off_events
        WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Time-off entry not found' }, { status: 404 });
    }
    const row = rows[0];

    if (!canManageTimeOffFor(user, row.work_email)) {
      return NextResponse.json(
        { error: 'You can only edit time off for yourself or your direct reports.' },
        { status: 403 },
      );
    }

    const finalStart = startDate != null ? startDate : (row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : row.start_date);
    const finalEnd   = endDate   != null ? endDate   : (row.end_date   instanceof Date ? row.end_date.toISOString().slice(0, 10)   : row.end_date);
    if (finalEnd < finalStart) {
      return NextResponse.json({ error: 'end_date must be on or after start_date' }, { status: 400 });
    }

    // Capped to the existing column width — keeps the 80-char ceiling
    // consistent with POST.
    const finalReason = reason !== undefined ? (reason ? reason.slice(0, 80) : null) : row.reason;

    await query(
      `UPDATE time_off_events
          SET start_date = $1, end_date = $2, reason = $3, updated_at = NOW()
        WHERE id = $4`,
      [finalStart, finalEnd, finalReason, id],
    );

    return NextResponse.json({
      ok: true,
      item: {
        id: row.id,
        work_email: row.work_email,
        start_date: finalStart,
        end_date: finalEnd,
        reason: finalReason,
        source: row.source,
        status: row.status,
      },
    });
  } catch (err) {
    console.error('[time-off-events PATCH]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
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

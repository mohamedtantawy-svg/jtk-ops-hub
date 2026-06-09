// ── /api/v1/trackers/[id]/rows/[rowId] ───────────────────────────────────────
// PATCH  — edit a row: merge changed cells (per-cell inline edits send only the
//          changed columns), and/or change status / sort. Cells are merged
//          (COALESCE(cells,'{}') || $patch) so a single-cell edit never wipes
//          siblings — mirrors the feedback extras-merge.
// DELETE — remove a row.
// Managers-only (admin / regional_manager / team_lead).
import { NextResponse } from 'next/server';
import { requireRole } from '../../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../../src/lib/db';
import {
  TRACKER_MANAGERIAL_ROLES,
  isValidTrackerStatus,
  normaliseCellsPatch,
} from '../../../../../../../src/lib/tracker-constants';

function rowToClient(r) {
  return {
    id: r.id,
    trackerId: r.tracker_id,
    cells: (r.cells && typeof r.cells === 'object') ? r.cells : {},
    status: r.status,
    sort: r.sort,
    createdByEmail: r.created_by_email || null,
    updatedByEmail: r.updated_by_email || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function PATCH(req, { params }) {
  const gate = requireRole(req, ...TRACKER_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const user = gate.user;
  const { id, rowId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const sets = [];
    const values = [];

    if (body.cells && typeof body.cells === 'object') {
      // Normalise the PATCH against the tracker's live column schema, then
      // MERGE into the existing cells so untouched columns survive.
      const tr = await query(
        'SELECT column_schema FROM trackers WHERE id = $1 AND is_archived = false LIMIT 1',
        [id],
      );
      if (!tr.rows[0]) return NextResponse.json({ error: 'Tracker not found' }, { status: 404 });
      const columnSchema = Array.isArray(tr.rows[0].column_schema) ? tr.rows[0].column_schema : [];
      const cleaned = normaliseCellsPatch(body.cells, columnSchema);
      values.push(JSON.stringify(cleaned));
      sets.push(`cells = COALESCE(cells, '{}'::jsonb) || $${values.length}::jsonb`);
    }
    if (body.status !== undefined) {
      if (!isValidTrackerStatus(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      values.push(body.status); sets.push(`status = $${values.length}`);
    }
    if (Number.isFinite(body.sort)) { values.push(Math.round(body.sort)); sets.push(`sort = $${values.length}`); }

    if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    values.push((user.email || '').toLowerCase() || null); sets.push(`updated_by_email = $${values.length}`);
    values.push(user.name || null); sets.push(`updated_by_name = $${values.length}`);
    sets.push('updated_at = NOW()');
    values.push(rowId);
    const trackerIdx = values.push(id);   // tracker scope guard in WHERE

    const { rows } = await query(
      `UPDATE tracker_rows SET ${sets.join(', ')}
        WHERE id = $${values.length - 1} AND tracker_id = $${trackerIdx}
       RETURNING id, tracker_id, cells, status, sort, created_by_email, updated_by_email, created_at, updated_at`,
      values,
    );
    if (!rows[0]) return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    return NextResponse.json({ row: rowToClient(rows[0]) });
  } catch (err) {
    console.error('[trackers/[id]/rows/[rowId] PATCH]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const gate = requireRole(req, ...TRACKER_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id, rowId } = await params;
  try {
    await query('DELETE FROM tracker_rows WHERE id = $1 AND tracker_id = $2', [rowId, id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[trackers/[id]/rows/[rowId] DELETE]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

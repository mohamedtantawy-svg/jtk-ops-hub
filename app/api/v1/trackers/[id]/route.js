// ── /api/v1/trackers/[id] ────────────────────────────────────────────────────
// GET    — one tracker (meta + column schema) WITH all its rows (the grid load).
// PATCH  — edit tracker meta / column schema / sort / archive.
// DELETE — remove a tracker (cascades its rows).
// Managers-only (admin / regional_manager / team_lead).
import { NextResponse } from 'next/server';
import { requireRole } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';
import {
  TRACKER_MANAGERIAL_ROLES,
  TRACKER_LIMITS,
  normaliseColumnSchema,
} from '../../../../../src/lib/tracker-constants';

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

export async function GET(req, { params }) {
  const gate = requireRole(req, ...TRACKER_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    const tr = await query(
      `SELECT id, key, name, type, description, column_schema, visibility, sort
         FROM trackers WHERE id = $1 AND is_archived = false LIMIT 1`,
      [id],
    );
    if (!tr.rows[0]) return NextResponse.json({ error: 'Tracker not found' }, { status: 404 });
    const t = tr.rows[0];
    const rr = await query(
      `SELECT id, tracker_id, cells, status, sort, created_by_email, updated_by_email, created_at, updated_at
         FROM tracker_rows WHERE tracker_id = $1 ORDER BY sort ASC, created_at ASC`,
      [id],
    );
    return NextResponse.json({
      tracker: {
        id: t.id, key: t.key, name: t.name, type: t.type, description: t.description || '',
        columnSchema: Array.isArray(t.column_schema) ? t.column_schema : [], visibility: t.visibility, sort: t.sort,
      },
      rows: rr.rows.map(rowToClient),
    });
  } catch (err) {
    console.error('[trackers/[id] GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  const gate = requireRole(req, ...TRACKER_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const sets = [];
    const values = [];
    if (typeof body.name === 'string') {
      const name = body.name.slice(0, TRACKER_LIMITS.name).trim();
      if (name) { values.push(name); sets.push(`name = $${values.length}`); }
    }
    if (typeof body.description === 'string') {
      values.push(body.description.slice(0, 500)); sets.push(`description = $${values.length}`);
    }
    if (Array.isArray(body.columnSchema)) {
      const schema = normaliseColumnSchema(body.columnSchema);
      if (schema.length === 0) return NextResponse.json({ error: 'At least one column is required' }, { status: 400 });
      values.push(JSON.stringify(schema)); sets.push(`column_schema = $${values.length}::jsonb`);
    }
    if (Number.isFinite(body.sort)) { values.push(Math.round(body.sort)); sets.push(`sort = $${values.length}`); }
    if (body.visibility === 'managers' || body.visibility === 'global') {
      values.push(body.visibility); sets.push(`visibility = $${values.length}`);
    }
    if (body.isArchived === true) { sets.push(`is_archived = true`); }
    if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    sets.push('updated_at = NOW()');
    values.push(id);
    const { rows } = await query(
      `UPDATE trackers SET ${sets.join(', ')} WHERE id = $${values.length}
       RETURNING id, key, name, type, description, column_schema, visibility, sort`,
      values,
    );
    if (!rows[0]) return NextResponse.json({ error: 'Tracker not found' }, { status: 404 });
    const t = rows[0];
    return NextResponse.json({
      tracker: {
        id: t.id, key: t.key, name: t.name, type: t.type, description: t.description || '',
        columnSchema: Array.isArray(t.column_schema) ? t.column_schema : [], visibility: t.visibility, sort: t.sort,
      },
    });
  } catch (err) {
    console.error('[trackers/[id] PATCH]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const gate = requireRole(req, ...TRACKER_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    await query('DELETE FROM trackers WHERE id = $1', [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[trackers/[id] DELETE]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

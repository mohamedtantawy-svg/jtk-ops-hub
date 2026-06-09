// ── /api/v1/trackers/[id]/rows ───────────────────────────────────────────────
// GET  — rows for one tracker.
// POST — append a row (cells normalised against the tracker's column schema).
// Managers-only (admin / regional_manager / team_lead).
import { NextResponse } from 'next/server';
import { requireRole } from '../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../src/lib/db';
import {
  TRACKER_MANAGERIAL_ROLES,
  TRACKER_LIMITS,
  DEFAULT_TRACKER_ROW_STATUS,
  isValidTrackerStatus,
  normaliseCells,
} from '../../../../../../src/lib/tracker-constants';

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

async function loadColumnSchema(trackerId) {
  const { rows } = await query(
    'SELECT column_schema FROM trackers WHERE id = $1 AND is_archived = false LIMIT 1',
    [trackerId],
  );
  if (!rows[0]) return null;
  return Array.isArray(rows[0].column_schema) ? rows[0].column_schema : [];
}

export async function GET(req, { params }) {
  const gate = requireRole(req, ...TRACKER_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    const { rows } = await query(
      `SELECT id, tracker_id, cells, status, sort, created_by_email, updated_by_email, created_at, updated_at
         FROM tracker_rows WHERE tracker_id = $1 ORDER BY sort ASC, created_at ASC`,
      [id],
    );
    return NextResponse.json({ rows: rows.map(rowToClient) });
  } catch (err) {
    console.error('[trackers/[id]/rows GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  const gate = requireRole(req, ...TRACKER_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const user = gate.user;
  const { id } = await params;
  try {
    const columnSchema = await loadColumnSchema(id);
    if (columnSchema == null) return NextResponse.json({ error: 'Tracker not found' }, { status: 404 });

    // Cap rows per tracker so a runaway client can't unbounded-insert.
    const cnt = await query('SELECT COUNT(*)::int AS n FROM tracker_rows WHERE tracker_id = $1', [id]);
    if ((cnt.rows[0]?.n || 0) >= TRACKER_LIMITS.rowsPerTracker) {
      return NextResponse.json({ error: 'Row limit reached for this tracker' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const cells = normaliseCells(body.cells, columnSchema);
    const status = isValidTrackerStatus(body.status) ? body.status : DEFAULT_TRACKER_ROW_STATUS;
    const email = (user.email || '').toLowerCase() || null;

    const { rows } = await query(
      `INSERT INTO tracker_rows (tracker_id, cells, status, sort, created_by_email, created_by_name, updated_by_email, updated_by_name)
       VALUES ($1, $2::jsonb, $3,
               COALESCE((SELECT MAX(sort) + 10 FROM tracker_rows WHERE tracker_id = $1), 0),
               $4, $5, $4, $5)
       RETURNING id, tracker_id, cells, status, sort, created_by_email, updated_by_email, created_at, updated_at`,
      [id, JSON.stringify(cells), status, email, user.name || null],
    );
    return NextResponse.json({ row: rowToClient(rows[0]) }, { status: 201 });
  } catch (err) {
    console.error('[trackers/[id]/rows POST]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

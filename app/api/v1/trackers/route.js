// ── /api/v1/trackers ─────────────────────────────────────────────────────────
// Generic tracker engine (the spreadsheet surfaces under the "Tracker" tab).
// GET  — list non-archived trackers (meta + column schema + row count). Lite:
//        does NOT return rows (those come from /trackers/[id] or /rows).
// POST — create a new tracker (the future "build your own tracker" entry point).
//
// Managers-only end-to-end (admin / regional_manager / team_lead). Agents 403 —
// the FE hides the grid sub-tabs for them, but this is the real enforcement.
import { NextResponse } from 'next/server';
import { requireRole } from '../../../../src/lib/auth-helpers';
import { query } from '../../../../src/lib/db';
import {
  TRACKER_MANAGERIAL_ROLES,
  TRACKER_LIMITS,
  normaliseColumnSchema,
} from '../../../../src/lib/tracker-constants';

function slugify(name) {
  return String(name || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 56) || 'tracker';
}

export async function GET(req) {
  const gate = requireRole(req, ...TRACKER_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const { rows } = await query(
      `SELECT t.id, t.key, t.name, t.type, t.description, t.column_schema,
              t.visibility, t.sort,
              COALESCE(rc.n, 0)::int AS row_count
         FROM trackers t
         LEFT JOIN (
           SELECT tracker_id, COUNT(*) AS n FROM tracker_rows GROUP BY tracker_id
         ) rc ON rc.tracker_id = t.id
        WHERE t.is_archived = false
        ORDER BY t.sort ASC, t.created_at ASC`,
    );
    const trackers = rows.map(r => ({
      id: r.id,
      key: r.key,
      name: r.name,
      type: r.type,
      description: r.description || '',
      columnSchema: Array.isArray(r.column_schema) ? r.column_schema : [],
      visibility: r.visibility,
      sort: r.sort,
      rowCount: r.row_count,
    }));
    return NextResponse.json({ trackers });
  } catch (err) {
    console.error('[trackers GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req) {
  const gate = requireRole(req, ...TRACKER_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const user = gate.user;
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || '').slice(0, TRACKER_LIMITS.name).trim();
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    const columnSchema = normaliseColumnSchema(body.columnSchema);
    if (columnSchema.length === 0) return NextResponse.json({ error: 'At least one column is required' }, { status: 400 });

    // Derive a unique key from the name (suffix a counter on collision).
    const base = slugify(name);
    let key = base;
    for (let i = 2; i <= 50; i++) {
      const { rows } = await query('SELECT 1 FROM trackers WHERE key = $1 LIMIT 1', [key]);
      if (rows.length === 0) break;
      key = `${base}_${i}`;
    }

    const visibility = body.visibility === 'global' ? 'global' : 'managers';
    const description = body.description ? String(body.description).slice(0, 500) : null;
    const { rows } = await query(
      `INSERT INTO trackers (key, name, type, description, column_schema, visibility, sort, created_by_email, created_by_name)
       VALUES ($1, $2, 'custom', $3, $4::jsonb, $5, COALESCE((SELECT MAX(sort) + 10 FROM trackers), 100), $6, $7)
       RETURNING id, key, name, type, description, column_schema, visibility, sort`,
      [key, name, description, JSON.stringify(columnSchema), visibility,
       (user.email || '').toLowerCase() || null, user.name || null],
    );
    const t = rows[0];
    return NextResponse.json({
      tracker: {
        id: t.id, key: t.key, name: t.name, type: t.type, description: t.description || '',
        columnSchema: Array.isArray(t.column_schema) ? t.column_schema : [], visibility: t.visibility, sort: t.sort, rowCount: 0,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[trackers POST]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

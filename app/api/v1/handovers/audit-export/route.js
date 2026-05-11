// ── GET /api/v1/handovers/audit-export ─────────────────────────────────
// Phase 5 of HANDOVERS_PLAN.md §14. Admin-only CSV export joining
// handover_log with handover metadata for a date range. The CSV is
// flat — one row per log entry — so post-launch auditors can answer
// "who moved this handover to status X and when" in Excel without
// touching the DB.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canManageHandoverSettings } from '../../../../../src/lib/handover-admin';

function ymdToIso(d) {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageHandoverSettings(user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');
  const from = fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : null;
  const to   = toRaw   && /^\d{4}-\d{2}-\d{2}$/.test(toRaw)   ? toRaw   : null;

  const where = [];
  const params = [];
  let p = 1;
  if (from) { where.push(`l.created_at >= $${p++}::date`); params.push(from); }
  if (to)   { where.push(`l.created_at <  $${p++}::date + INTERVAL '1 day'`); params.push(to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const { rows } = await query(
      `SELECT l.id, l.handover_id, l.event_type, l.actor_email, l.actor_name,
              l.detail, l.created_at,
              h.requester_email, h.manager_email, h.start_date, h.end_date,
              h.status AS handover_status
         FROM handover_log l
         JOIN handovers h ON h.id = l.handover_id
         ${whereSql}
        ORDER BY l.created_at ASC
        LIMIT 100000`,
      params,
    );

    const headers = [
      'log_id', 'created_at', 'handover_id', 'event_type',
      'actor_email', 'actor_name',
      'requester_email', 'manager_email', 'start_date', 'end_date',
      'handover_status', 'detail_json',
    ];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.id,
        ymdToIso(r.created_at),
        r.handover_id,
        r.event_type,
        r.actor_email || '',
        r.actor_name || '',
        r.requester_email || '',
        r.manager_email || '',
        r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : (r.start_date || ''),
        r.end_date   instanceof Date ? r.end_date.toISOString().slice(0, 10)   : (r.end_date || ''),
        r.handover_status || '',
        r.detail ? JSON.stringify(r.detail) : '',
      ].map(csvEscape).join(','));
    }
    const csv = lines.join('\n');

    const filename = `handover-audit-${from || 'all'}-${to || 'now'}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('[handovers/audit-export GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

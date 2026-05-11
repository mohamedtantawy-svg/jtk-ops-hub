// ── POST /api/v1/time-off-events/import ───────────────────────────────
// Phase 5 of HANDOVERS_PLAN.md. Admin-only CSV re-import endpoint.
// Accepts a multipart upload with a single `file` part containing the
// HRX time-off report shape (Start Date, End Date, Work Email).
//
// Reuses the parsing logic from scripts/convert-time-off-csv.mjs — same
// date formats accepted, same column-header tolerance, same dedupe
// rules. Writes a row to time_off_import_batches so every reimport has
// a provenance record (HANDOVERS_PLAN.md §14 audit pillar).

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canManageHandoverSettings } from '../../../../../src/lib/handover-admin';
import { invalidateAndReloadHandoverScopeCache } from '../../../../../src/lib/handover-scope-cache-loader';

const MAX_BYTES = 5 * 1024 * 1024;   // 5 MB ceiling per HANDOVERS_PLAN.md §19 security row
const MONTHS = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
};

function pad2(n) { return String(n).padStart(2, '0'); }
function parseHrxDate(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/"/g, '').trim();
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  const m = cleaned.match(/^([A-Za-z]{3,})\s+(\d{1,2})[, ]+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  const day   = parseInt(m[2], 10);
  const year  = parseInt(m[3], 10);
  if (!month || !day || !year) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function splitCsvLine(line) {
  const out = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map(s => s.trim());
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageHandoverSettings(user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let form;
  try { form = await req.formData(); }
  catch (err) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Missing "file" part' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `CSV too large (max ${MAX_BYTES} bytes)` }, { status: 413 });
  }

  let text;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    text = buf.toString('utf8');
  } catch {
    return NextResponse.json({ error: 'Could not read CSV body' }, { status: 400 });
  }

  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) {
    return NextResponse.json({ error: 'CSV has no data rows' }, { status: 400 });
  }
  const header = splitCsvLine(lines[0]).map(s => s.toLowerCase());
  const iStart = header.findIndex(h => /^start/.test(h));
  const iEnd   = header.findIndex(h => /^end/.test(h));
  const iEmail = header.findIndex(h => /email/.test(h));
  if (iStart < 0 || iEnd < 0 || iEmail < 0) {
    return NextResponse.json({
      error: 'CSV header must include Start Date, End Date, Work Email',
      saw: header,
    }, { status: 400 });
  }

  const rows = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const start = parseHrxDate(cols[iStart]);
    const end   = parseHrxDate(cols[iEnd]);
    const email = (cols[iEmail] || '').toLowerCase().trim();
    if (!email || !email.includes('@') || !start || !end || start > end) {
      errors.push({ line: i + 1, cols: cols.slice(0, 6) });
      continue;
    }
    rows.push({ email, start, end });
  }

  try {
    const result = await withTransaction(async (client) => {
      const batch = await client.query(
        `INSERT INTO time_off_import_batches
           (source, filename, uploaded_by_email, rows_total, rows_invalid, error_log)
         VALUES ('csv', $1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [
          (file.name || 'upload.csv').slice(0, 500),
          user.email.toLowerCase(),
          rows.length + errors.length,
          errors.length,
          JSON.stringify(errors.slice(0, 200)),
        ],
      );
      const batchId = batch.rows[0].id;

      let inserted = 0;
      let skipped = 0;
      // Chunk the bulk insert at 500 rows per query to keep parameter
      // count comfortably below Postgres' 65k limit even for very large
      // pastes.
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const valuesSql = chunk
          .map((_, j) => `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`)
          .join(', ');
        const params = chunk.flatMap(r => [r.email, r.start, r.end, batchId]);
        const ins = await client.query(
          `INSERT INTO time_off_events (work_email, start_date, end_date, imported_batch)
           VALUES ${valuesSql}
           ON CONFLICT (work_email, start_date, end_date, source) DO NOTHING
           RETURNING id`,
          params,
        );
        inserted += ins.rowCount;
        skipped += chunk.length - ins.rowCount;
      }

      await client.query(
        `UPDATE time_off_import_batches
            SET rows_inserted = $1, rows_skipped = $2
          WHERE id = $3`,
        [inserted, skipped, batchId],
      );
      return { batchId, inserted, skipped, invalid: errors.length };
    });

    // New events may unlock a previously missing handover for a coverer
    // — reload the cache once.
    invalidateAndReloadHandoverScopeCache();

    return NextResponse.json({
      ok: true,
      batch_id: result.batchId,
      rows_total: rows.length + errors.length,
      rows_inserted: result.inserted,
      rows_skipped: result.skipped,
      rows_invalid: result.invalid,
      error_sample: errors.slice(0, 10),
    });
  } catch (err) {
    console.error('[time-off-events/import POST]', err.message);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

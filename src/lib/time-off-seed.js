// ── Time-off events seed ───────────────────────────────────────────────────
// Bootstraps time_off_events from src/data/time_off_seed.json (the bundled
// snapshot of the HRX time-off report, regenerated via
// scripts/convert-time-off-csv.mjs). Day-to-day refreshes go through
// /api/v1/time-off-events/import (CSV upload, Phase 5) or
// /api/v1/time-off-events/sync-deel (Deel API pull, Phase 5).
//
// Versioned ADDITIVE seed — same pattern as country-owners-seed.js:
//   • Version marker lives in app_settings.time_off_seed_version.
//   • On boot, if stored version < SEED_VERSION, INSERT any missing
//     (work_email, start_date, end_date, source='csv') rows. ON CONFLICT
//     DO NOTHING keeps the operation idempotent and concurrent-safe.
//   • Manual imports (rows with source='csv' but different windows, or
//     source='deel_api' rows) are NEVER touched. The seed only adds
//     baseline rows; it never deletes.
//   • Bumping SEED_VERSION + checking in a regenerated time_off_seed.json
//     is the only way to push new baseline rows after the initial boot.
//
// One audit row per seed run is written to time_off_import_batches so a
// later operator can answer "did the v1 baseline seed actually land?"
// without relying on the seed-version key alone.

import { query } from './db';
import seed from '../data/time_off_seed.json' with { type: 'json' };

// Bump when src/data/time_off_seed.json is regenerated AND you want the
// new rows applied on next boot. Existing rows are preserved either way
// thanks to the unique constraint + ON CONFLICT DO NOTHING.
const SEED_VERSION = 1;
const VERSION_KEY = 'time_off_seed_version';

async function getStoredVersion() {
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1`,
      [VERSION_KEY],
    );
    const v = rows[0]?.value?.version;
    return Number.isFinite(v) ? v : 0;
  } catch (err) {
    console.warn('[time-off-seed] version read failed:', err?.message);
    return 0;
  }
}

async function setStoredVersion(version) {
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
    [VERSION_KEY, JSON.stringify({ version }), 'time-off-seed'],
  );
}

function normaliseRows(payload) {
  if (!payload || !Array.isArray(payload.rows)) return [];
  const out = [];
  for (const r of payload.rows) {
    const email = (r?.work_email || '').toLowerCase().trim();
    const start = (r?.start_date || '').trim();
    const end   = (r?.end_date   || '').trim();
    if (!email || !email.includes('@')) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
    if (start > end) continue;
    out.push({ email, start, end });
  }
  return out;
}

/**
 * Idempotent boot-time seed. Returns
 *   { skipped: true } when already at SEED_VERSION
 *   { reseeded: true, inserted, skipped, total, batchId, version } on a run.
 */
export async function seedTimeOffEventsIfNeeded() {
  const currentVersion = await getStoredVersion();
  if (currentVersion >= SEED_VERSION) {
    return { skipped: true, version: SEED_VERSION };
  }

  const rows = normaliseRows(seed);
  if (rows.length === 0) {
    console.warn('[time-off-seed] seed payload empty or malformed; skipping');
    return { skipped: true, version: SEED_VERSION };
  }

  await query('BEGIN');
  try {
    // One audit row per seed run, regardless of how many rows actually
    // land. rows_inserted is populated after the bulk insert.
    const batchInsert = await query(
      `INSERT INTO time_off_import_batches
         (source, filename, uploaded_by_email, rows_total)
       VALUES ('csv', $1, 'time-off-seed', $2)
       RETURNING id`,
      [seed?.sourceFile || 'time_off_seed.json', rows.length],
    );
    const batchId = batchInsert.rows[0]?.id;

    // Bulk insert with positional params. 1245 rows × 4 cols = 4980 params
    // — well under pg's 65k limit. If the seed ever grows past ~10k rows
    // we'd need to chunk; for now one INSERT is fine.
    const valuesSql = rows
      .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
      .join(', ');
    const params = rows.flatMap(r => [r.email, r.start, r.end, batchId]);
    const insertResult = await query(
      `INSERT INTO time_off_events
         (work_email, start_date, end_date, imported_batch)
       VALUES ${valuesSql}
       ON CONFLICT (work_email, start_date, end_date, source) DO NOTHING
       RETURNING id`,
      params,
    );
    const inserted = insertResult.rowCount ?? insertResult.rows.length;
    const skipped = rows.length - inserted;

    await query(
      `UPDATE time_off_import_batches
          SET rows_inserted = $1,
              rows_skipped  = $2
        WHERE id = $3`,
      [inserted, skipped, batchId],
    );

    await setStoredVersion(SEED_VERSION);
    await query('COMMIT');

    console.log(
      `[time-off-seed] v${SEED_VERSION}: ${inserted} new event(s) inserted, ` +
      `${skipped} already present (was v${currentVersion})`,
    );
    return {
      reseeded: true,
      inserted,
      skipped,
      total: rows.length,
      batchId,
      version: SEED_VERSION,
    };
  } catch (err) {
    try { await query('ROLLBACK'); } catch {}
    console.error('[time-off-seed] seed failed:', err?.message);
    return { skipped: false, error: err?.message, version: SEED_VERSION };
  }
}

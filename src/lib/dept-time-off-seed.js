// ── Dept-scoped time-off seed ──────────────────────────────────────────────
// Reusable variant of time-off-seed.js for any non-HRX department. Each
// dept brings its own JSON baseline (CSV-converted via
// scripts/convert-time-off-csv.mjs); the GIX seed is the first user but
// the function is generic so a new dept just drops in a new JSON file +
// a new version key.
//
// CRITICAL DIFFERENCE FROM time-off-seed.js (HRX baseline):
//   • HRX seed inserts rows with org_node_id = NULL and relies on the
//     boot-time dept-backfill (Phase 11a) to stamp them with HRX UUID
//     in one pass.
//   • Dept seed (this module) MUST resolve the dept's UUID via
//     `org_nodes.slug` and stamp `org_node_id` EXPLICITLY on every
//     INSERT. The dept-backfill is sentinel-gated — it only ever stamps
//     NULL → HRX once. If we left dept rows NULL, they'd either be
//     mis-tagged as HRX on a future backfill or stay forever orphaned
//     from the dept filter.
//
// Versioned ADDITIVE seed (same pattern as time-off-seed.js + skill §3.8):
//   • Version marker lives in app_settings.<versionKey>.
//   • On boot, if stored version < SEED_VERSION, INSERT any missing
//     (work_email, start_date, end_date, source='csv') rows with the
//     dept's org_node_id pre-stamped. ON CONFLICT DO NOTHING keeps the
//     operation idempotent.
//   • Manual imports + Deel-API rows are never touched.
//   • Audit row written to time_off_import_batches per seed run.

import { query } from './db';

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
    const leaveType = (r?.leave_type || '').trim().slice(0, 60) || null;
    out.push({ email, start, end, leaveType });
  }
  return out;
}

async function getStoredVersion(versionKey) {
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1`,
      [versionKey],
    );
    const v = rows[0]?.value?.version;
    return Number.isFinite(v) ? v : 0;
  } catch (err) {
    console.warn(`[dept-time-off-seed:${versionKey}] version read failed:`, err?.message);
    return 0;
  }
}

async function setStoredVersion(versionKey, version, sentinel = null) {
  const payload = sentinel ? { version, ...sentinel } : { version };
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
    [versionKey, JSON.stringify(payload), 'dept-time-off-seed'],
  );
}

/**
 * Idempotent boot-time seed for a single dept's time-off baseline.
 *
 * @param {object} args
 * @param {string} args.deptSlug      — org_nodes.slug (e.g. 'gix')
 * @param {object} args.seedPayload   — { sourceFile, rows: [...] }
 * @param {number} args.seedVersion   — bump when payload changes
 * @param {string} args.versionKey    — app_settings row key (e.g. 'gix_time_off_seed_version')
 *
 * Returns one of:
 *   { skipped: true, reason } — version already at SEED_VERSION, or
 *                               dept slug not found in org_nodes (records
 *                               sentinel so the seed retries on next
 *                               version bump rather than every boot)
 *   { reseeded: true, inserted, skipped, total, batchId, version, deptId }
 *   { skipped: false, error, version } — exception mid-flight
 */
export async function seedDeptTimeOffEventsIfNeeded({ deptSlug, seedPayload, seedVersion, versionKey }) {
  if (!deptSlug || !seedPayload || !seedVersion || !versionKey) {
    return { skipped: true, reason: 'missing-args' };
  }

  const currentVersion = await getStoredVersion(versionKey);
  if (currentVersion >= seedVersion) {
    return { skipped: true, reason: 'version-current', version: seedVersion };
  }

  // Resolve the dept's UUID by slug — never hardcode UUIDs (slugs are
  // stable per skill mistake #50). Fail closed if the dept node doesn't
  // exist yet (e.g. a brand-new env where org_default_seed hasn't run).
  // Record the skip with a sentinel so version-bump retries pick it up.
  const { rows: nodeRows } = await query(
    `SELECT id FROM org_nodes
      WHERE slug = $1 AND parent_id IS NULL AND is_archived = false LIMIT 1`,
    [deptSlug],
  );
  const deptId = nodeRows[0]?.id || null;
  if (!deptId) {
    console.warn(`[dept-time-off-seed:${versionKey}] dept slug "${deptSlug}" not found; skipping`);
    // Don't bump the version — a future bump should re-attempt. The
    // sentinel-skip pattern only locks if the dept is permanently
    // missing, which isn't a real scenario here.
    return { skipped: true, reason: 'dept-not-found', deptSlug };
  }

  const rows = normaliseRows(seedPayload);
  if (rows.length === 0) {
    console.warn(`[dept-time-off-seed:${versionKey}] seed payload empty or malformed; skipping`);
    return { skipped: true, reason: 'empty-payload', deptSlug };
  }

  await query('BEGIN');
  try {
    // Audit row first so a failed bulk insert still has provenance.
    const batchInsert = await query(
      `INSERT INTO time_off_import_batches
         (source, filename, uploaded_by_email, rows_total)
       VALUES ('csv', $1, $2, $3)
       RETURNING id`,
      [seedPayload?.sourceFile || `${deptSlug}_time_off_seed.json`, `dept-time-off-seed:${deptSlug}`, rows.length],
    );
    const batchId = batchInsert.rows[0]?.id;

    // Bulk INSERT with the dept's org_node_id stamped on every row + the Deel
    // leave_type. 729 rows × 6 cols = 4374 params for GIX — well under pg's
    // 65k limit. If a dept ever brings > ~10k rows we'd need to chunk; not
    // needed today. ON CONFLICT ENRICHES an existing row's leave_type instead
    // of skipping (COALESCE keeps a prior type when the new row has none) —
    // additive + non-destructive, so handover links + manual edits survive.
    // `xmax = 0` separates fresh inserts from enriched updates for the audit.
    const valuesSql = rows
      .map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`)
      .join(', ');
    const params = rows.flatMap(r => [r.email, r.start, r.end, r.leaveType, batchId, deptId]);
    const insertResult = await query(
      `INSERT INTO time_off_events
         (work_email, start_date, end_date, leave_type, imported_batch, org_node_id)
       VALUES ${valuesSql}
       ON CONFLICT (work_email, start_date, end_date, source) DO UPDATE
         SET leave_type = COALESCE(EXCLUDED.leave_type, time_off_events.leave_type),
             updated_at = NOW()
       RETURNING (xmax = 0) AS is_insert`,
      params,
    );
    const inserted = insertResult.rows.filter(r => r.is_insert).length;
    const skipped = insertResult.rows.length - inserted;

    await query(
      `UPDATE time_off_import_batches
          SET rows_inserted = $1,
              rows_skipped  = $2
        WHERE id = $3`,
      [inserted, skipped, batchId],
    );

    await setStoredVersion(versionKey, seedVersion, { deptSlug, deptId });
    await query('COMMIT');

    console.log(
      `[dept-time-off-seed:${versionKey}] v${seedVersion} (${deptSlug}): ${inserted} new event(s) inserted, ` +
      `${skipped} existing enriched with leave_type (was v${currentVersion}, dept=${deptId.slice(0, 8)})`,
    );
    return {
      reseeded: true,
      inserted,
      skipped,
      total: rows.length,
      batchId,
      version: seedVersion,
      deptId,
      deptSlug,
    };
  } catch (err) {
    try { await query('ROLLBACK'); } catch {}
    console.error(`[dept-time-off-seed:${versionKey}] seed failed:`, err?.message);
    return { skipped: false, error: err?.message, version: seedVersion, deptSlug };
  }
}

// ── GIX wrapper ───────────────────────────────────────────────────────────
// Mohamed Tantawy 2026-05-22: 691-row GIX Time Off Report (Jan–Dec 2026,
// 81 immigration team members). Imported once + stamped with the GIX
// org_node_id at insert time so Phase 11e's read filter
// (org_node_id = currentDeptId) shows these only to GIX users / the
// super-admin viewing GIX.

import gixSeed from '../data/gix_time_off_seed.json' with { type: 'json' };

// v2 (2026-06-09, Derek House "GIX - OOO Tracking"): regenerated from the
// Jun 09 GIX Time Off Report (729 windows, incl. Antonella Baletto's leave
// that the May snapshot missed) and now carries the Deel Policy Type via
// `leave_type`. Additive + enrich-on-conflict, so existing GIX events +
// handovers are preserved. Version bump re-runs the seed body on next boot.
const GIX_SEED_VERSION = 2;
const GIX_VERSION_KEY = 'gix_time_off_seed_version';

export async function seedGixTimeOffEventsIfNeeded() {
  return seedDeptTimeOffEventsIfNeeded({
    deptSlug: 'gix',
    seedPayload: gixSeed,
    seedVersion: GIX_SEED_VERSION,
    versionKey: GIX_VERSION_KEY,
  });
}

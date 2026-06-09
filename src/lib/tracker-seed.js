// ── Tracker seed (2026-06-09) ─────────────────────────────────────────────────
// Boot-time seed for the two built-in spreadsheet trackers (Mass Onboarding /
// Mass Offboarding) on the generic tracker engine. Idempotent via a
// SEED_VERSION sentinel in app_settings (mirrors escalation-zero-seed.js).
//
// UPSERT ON CONFLICT (key) DO NOTHING — so once a tracker exists, a re-seed
// NEVER overwrites its column_schema (managers may have tweaked columns) and
// NEVER touches its rows. Bump SEED_VERSION only to introduce NEW built-in
// trackers; existing ones are left alone. User-built custom trackers are
// created at runtime via the API and are unaffected by this seed.

import { query } from './db';
import { MASS_TRACKER_COLUMNS, MASS_TRACKER_DEFS } from './tracker-constants';

const SEED_VERSION = 1;
const SEED_KEY = 'tracker_seed_version';

async function getStoredVersion() {
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
      [SEED_KEY],
    );
    if (!rows[0]) return 0;
    const v = Number(rows[0].value);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

async function setStoredVersion(version) {
  await query(
    `INSERT INTO app_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SEED_KEY, String(version)],
  );
}

/**
 * Insert the built-in Mass Onboarding / Mass Offboarding trackers if they
 * don't exist yet. No-op once the version sentinel is current. Returns
 * { reseeded, version, inserted } (or { reseeded:false } when already seeded).
 */
export async function seedTrackersIfNeeded() {
  const currentVersion = await getStoredVersion();
  if (currentVersion >= SEED_VERSION) {
    return { reseeded: false, version: SEED_VERSION };
  }

  let inserted = 0;
  const schemaJson = JSON.stringify(MASS_TRACKER_COLUMNS);
  for (const def of MASS_TRACKER_DEFS) {
    try {
      const { rowCount } = await query(
        `INSERT INTO trackers (key, name, type, column_schema, visibility, sort, created_by_name)
         VALUES ($1, $2, $3, $4::jsonb, 'managers', $5, 'system')
         ON CONFLICT (key) DO NOTHING`,
        [def.key, def.name, def.type, schemaJson, def.sort],
      );
      inserted += rowCount || 0;
    } catch (err) {
      console.warn(`[tracker-seed] insert ${def.key} failed:`, err?.message);
    }
  }

  await setStoredVersion(SEED_VERSION);
  return { reseeded: true, version: SEED_VERSION, inserted };
}

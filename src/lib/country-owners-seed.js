// ── Country-ownership seed ──────────────────────────────────────────────────
// Source-of-truth seeder for team_member_countries. Reads
// src/data/csv_country_owners_seed.json — an email-keyed map produced by
// auditing the Deel "Countries by Person Role" spreadsheet against the
// HRX roster — and reconciles the DB to match.
//
// Versioned re-seed:
//   • A copy of the seed version is stored in app_settings.
//   • On boot, if the stored version is below the current SEED_VERSION, we
//     wipe team_member_countries and re-insert from the JSON. This is the
//     ONLY codepath that re-seeds — manual edits via the Team-tab picker
//     between deploys are preserved as long as SEED_VERSION isn't bumped.
//   • To roll out a corrected ownership map: bump SEED_VERSION and ship.
//
// Earlier versions seeded by fuzzy-matching CSV "Country Owner" names
// against members. v2 onwards is email-keyed so there's no ambiguity
// about which person owns a country.

import { query } from './db';
import seed from '../data/csv_country_owners_seed.json' with { type: 'json' };

// Bump this when the seed JSON is materially updated (added owners,
// removed owners, fixed wrong assignments). The next deploy will detect
// the bump, wipe team_member_countries, and re-insert from the JSON.
const SEED_VERSION = 2;
const VERSION_KEY = 'country_owners_seed_version';

function isEmail(s) {
  return typeof s === 'string' && /@/.test(s);
}

function normalizeRows(seedJson) {
  // Accept the email-keyed shape: { "AT": ["pilvi.pirhonen@deel.com", ...] }.
  // Reject the legacy name-keyed shape (v1) — pre-v2 seeds carried lower-
  // cased display names and can't be reconciled to emails without the
  // fuzzy-matcher we deliberately removed. If we see one, log + skip so
  // the deploy still boots cleanly.
  const rows = [];
  for (const [cc, owners] of Object.entries(seedJson || {})) {
    if (!cc || !Array.isArray(owners)) continue;
    const upperCc = cc.toUpperCase();
    for (const owner of owners) {
      if (!isEmail(owner)) {
        console.warn(`[country-owners-seed] non-email owner in seed for ${upperCc}: ${owner}`);
        continue;
      }
      rows.push({ email: owner.toLowerCase(), cc: upperCc });
    }
  }
  return rows;
}

async function getStoredVersion() {
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1`,
      [VERSION_KEY],
    );
    const v = rows[0]?.value?.version;
    return Number.isFinite(v) ? v : 0;
  } catch (err) {
    console.warn('[country-owners-seed] version read failed:', err?.message);
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
    [VERSION_KEY, JSON.stringify({ version }), 'country-owners-seed'],
  );
}

/**
 * Reconcile team_member_countries with the seed JSON whenever the stored
 * seed version is below the current SEED_VERSION. Idempotent within a
 * single version: a second boot at the same version no-ops.
 *
 * Returns { reseeded: boolean, inserted?: number, version: number }.
 */
export async function seedCountryOwnersIfEmpty() {
  const currentVersion = await getStoredVersion();
  if (currentVersion >= SEED_VERSION) {
    return { reseeded: false, version: SEED_VERSION };
  }

  const rows = normalizeRows(seed);
  if (rows.length === 0) {
    console.warn('[country-owners-seed] seed JSON is empty or malformed; skipping');
    return { reseeded: false, version: SEED_VERSION };
  }

  // Single transaction: wipe existing rows then re-insert from the seed.
  // Lock the table to prevent racing with a Team-tab PUT mid-reseed.
  await query('BEGIN');
  try {
    await query('LOCK TABLE team_member_countries IN ACCESS EXCLUSIVE MODE');
    await query('DELETE FROM team_member_countries');
    const valuesSql = rows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
    const params = rows.flatMap(r => [r.email, r.cc]);
    await query(
      `INSERT INTO team_member_countries (email, country_code) VALUES ${valuesSql}
        ON CONFLICT (email, country_code) DO NOTHING`,
      params,
    );
    await setStoredVersion(SEED_VERSION);
    await query('COMMIT');
    console.log(`[country-owners-seed] re-seeded to v${SEED_VERSION}: ${rows.length} (email, country) pairs across ${Object.keys(seed).length} countries (was v${currentVersion})`);
    return { reseeded: true, inserted: rows.length, version: SEED_VERSION };
  } catch (err) {
    try { await query('ROLLBACK'); } catch {}
    console.error('[country-owners-seed] re-seed failed:', err?.message);
    return { reseeded: false, error: err?.message, version: SEED_VERSION };
  }
}

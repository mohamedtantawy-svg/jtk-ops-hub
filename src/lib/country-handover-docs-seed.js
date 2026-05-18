// ── Country Handover Docs — first-boot seed ───────────────────────────────
// Inserts one `status = 'draft'` row in country_handover_docs for every
// distinct country code present in team_member_countries. Idempotent: a
// country code that already has a doc row is skipped. The point of the
// seed is to give every owned country a stable URL (/handover-docs/<CC>)
// from boot, so the Phase B editor never has to handle a "no row yet"
// branch — it's always editing an existing row.
//
// Versioning: bump COUNTRY_HANDOVER_DOCS_SEED_VERSION when you want every
// deploy to re-check the seed. Existing rows are never overwritten — only
// missing country codes get a new draft row added. Mirrors the same
// version-marker pattern as handover-defaults-seed / leader-alerts-seed.

import { query } from './db';

export const COUNTRY_HANDOVER_DOCS_SEED_VERSION = 1;
const VERSION_KEY = 'country_handover_docs_seed_version';

async function getStoredVersion() {
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1`,
      [VERSION_KEY],
    );
    const v = rows[0]?.value?.version;
    return Number.isFinite(v) ? v : 0;
  } catch {
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
    [VERSION_KEY, JSON.stringify({ version }), 'country-handover-docs-seed'],
  );
}

/**
 * Idempotent. Inserts one draft `country_handover_docs` row per distinct
 * 2-letter country code in team_member_countries that doesn't already
 * have a doc. Returns { skipped: true } on version no-op, or
 * { reseeded: true, inserted, candidates, version } when it ran.
 */
export async function seedCountryHandoverDocsIfNeeded() {
  const currentVersion = await getStoredVersion();
  if (currentVersion >= COUNTRY_HANDOVER_DOCS_SEED_VERSION) {
    return { skipped: true, version: COUNTRY_HANDOVER_DOCS_SEED_VERSION };
  }

  try {
    // ISO-2 only — team_member_countries.country_code is VARCHAR(10) so
    // we filter to LENGTH = 2 to avoid seeding rows for legacy 3-letter
    // codes the picker no longer emits.
    const { rows } = await query(
      `SELECT DISTINCT UPPER(country_code) AS cc
         FROM team_member_countries
        WHERE country_code IS NOT NULL
          AND LENGTH(country_code) = 2`,
    );
    const candidates = rows.map(r => r.cc).filter(Boolean);
    if (candidates.length === 0) {
      await setStoredVersion(COUNTRY_HANDOVER_DOCS_SEED_VERSION);
      return {
        reseeded: true,
        inserted: 0,
        candidates: 0,
        version: COUNTRY_HANDOVER_DOCS_SEED_VERSION,
      };
    }

    // INSERT … ON CONFLICT DO NOTHING — country_code is UNIQUE so existing
    // rows (manual or seeded earlier) are preserved untouched.
    const placeholders = candidates.map((_, i) => `($${i + 1})`).join(', ');
    const result = await query(
      `INSERT INTO country_handover_docs (country_code)
       VALUES ${placeholders}
       ON CONFLICT (country_code) DO NOTHING
       RETURNING id`,
      candidates,
    );
    const inserted = result.rowCount || 0;

    await setStoredVersion(COUNTRY_HANDOVER_DOCS_SEED_VERSION);

    console.log(
      `[country-handover-docs-seed] v${COUNTRY_HANDOVER_DOCS_SEED_VERSION}: ` +
      `${inserted}/${candidates.length} draft rows inserted ` +
      `(was v${currentVersion})`,
    );
    return {
      reseeded: true,
      inserted,
      candidates: candidates.length,
      version: COUNTRY_HANDOVER_DOCS_SEED_VERSION,
    };
  } catch (err) {
    console.error('[country-handover-docs-seed] failed:', err?.message);
    return {
      skipped: false,
      error: err?.message,
      version: COUNTRY_HANDOVER_DOCS_SEED_VERSION,
    };
  }
}

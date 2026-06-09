// ── Performance templates seed (2026-06-09) ────────────────────────────────
// Seeds the 5 HRX role evaluation templates (Country Owners / 24-7 HRX / SWAT
// & New Services / New Services / Team Leads) into perf_templates under the
// HR Experience department. Idempotent via the SEED_VERSION sentinel + a
// per-row NOT-EXISTS guard so a re-seed never overwrites templates a dept has
// edited via Settings. Other departments start with no templates and create
// their own from the Settings editor (or clone HRX's). Criteria + names come
// from data/perf_templates_seed.json (extracted from the legacy Gsheet).

import fs from 'node:fs';
import path from 'node:path';
import { query } from './db';

const SEED_VERSION = 1;
const SEED_KEY = 'perf_templates_seed_version';
const HRX_SLUG = 'hr-experience';

let seedData = null;
try {
  const p = path.join(process.cwd(), 'data', 'perf_templates_seed.json');
  if (fs.existsSync(p)) seedData = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (err) {
  console.warn('[perf-templates-seed] failed to load JSON:', err?.message);
}

async function getStoredVersion() {
  try {
    const { rows } = await query(`SELECT value FROM app_settings WHERE key = $1 LIMIT 1`, [SEED_KEY]);
    if (!rows[0]) return 0;
    const v = Number(rows[0].value);
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}
async function setStoredVersion(v) {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SEED_KEY, String(v)],
  );
}

export async function seedPerfTemplatesIfNeeded() {
  if (!seedData || !Array.isArray(seedData.rows)) return { reseeded: false, reason: 'no-data' };
  const currentVersion = await getStoredVersion();
  if (currentVersion >= SEED_VERSION) return { reseeded: false, version: SEED_VERSION };

  let orgNodeId = null;
  try {
    const { rows } = await query(`SELECT id FROM org_nodes WHERE slug = $1 LIMIT 1`, [HRX_SLUG]);
    orgNodeId = rows[0]?.id || null;
  } catch (err) {
    console.warn('[perf-templates-seed] HRX org_node lookup failed:', err?.message);
  }
  if (!orgNodeId) {
    // Don't burn the version — let a later boot (once org_nodes is seeded) retry.
    return { reseeded: false, reason: 'no-hrx-dept' };
  }

  let inserted = 0;
  for (const t of seedData.rows) {
    if (!t?.role_key || !t?.name) continue;
    try {
      const { rowCount } = await query(
        `INSERT INTO perf_templates
           (org_node_id, role_key, name, version, weights, operations_criteria, growth_criteria, ops_thresholds, growth_thresholds)
         SELECT $1, $2, $3, 1, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM perf_templates
            WHERE org_node_id = $1 AND role_key = $2 AND is_archived = false
         )`,
        [
          orgNodeId, t.role_key, t.name,
          JSON.stringify(t.weights || { operations: 0.5, kpi: 0.3, growth: 0.2 }),
          JSON.stringify(t.operations_criteria || []),
          JSON.stringify(t.growth_criteria || []),
          t.ops_thresholds ? JSON.stringify(t.ops_thresholds) : null,
          t.growth_thresholds ? JSON.stringify(t.growth_thresholds) : null,
        ],
      );
      inserted += rowCount || 0;
    } catch (err) {
      console.warn(`[perf-templates-seed] insert ${t.role_key} failed:`, err?.message);
    }
  }

  await setStoredVersion(SEED_VERSION);
  return { reseeded: true, version: SEED_VERSION, inserted, orgNodeId };
}

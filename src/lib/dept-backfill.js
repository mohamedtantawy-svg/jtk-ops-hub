// ── Dept-tenancy backfill (Phase 11a — 2026-05-20) ─────────────────────────
// Single combined backfill that stamps every existing row across every
// isolated surface table with HR Experience's UUID. Runs once at boot via
// the `dept_backfill_version` sentinel; idempotent on re-run.
//
// HRX-no-impact contract: this is THE safety guarantee. After this runs,
// every existing announcement / hr_hub_request / leader_alert / task /
// time_off_event / handover / urgent_assist row has org_node_id =
// HR Experience UUID. Phase 11b+ read filters use `WHERE org_node_id =
// currentDeptId` — HRX users resolve to HRX, the filter matches every
// existing row exactly, no data shifts.

import { query } from './db';

// Bump to v2 (2026-05-25) to fold mention_group into the same backfill
// (Phase 12b — per-dept mention groups). Skill mistake #51: never re-run a
// seed body without bumping the sentinel — the v1-completed guard would
// otherwise skip the mention_group UPDATE on every boot. Tables already
// stamped in v1 stay no-ops (UPDATE ... WHERE org_node_id IS NULL).
const BACKFILL_VERSION = 2;
const BACKFILL_KEY = 'dept_backfill_version';
const HR_EXPERIENCE_SLUG = 'hr-experience';

// Every table that gained org_node_id in the Phase 11a SCHEMA_SQL block
// plus the Phase 12b addition (mention_group). Re-runs are idempotent —
// each UPDATE is `WHERE org_node_id IS NULL`, so already-stamped rows are
// skipped automatically.
const SURFACE_TABLES = [
  'announcements',
  'hr_hub_request',
  'leader_alert',
  'urgent_assist_request',
  'urgent_assist_schedule',
  'time_off_events',
  'handovers',
  'tasks',
  'workspace_members',
  'mention_group',
];

export async function backfillHrExperienceTenancyIfNeeded() {
  // ── Version sentinel ─────────────────────────────────────────────────────
  let currentVersion = 0;
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1`,
      [BACKFILL_KEY],
    );
    if (rows[0]?.value) {
      const v = typeof rows[0].value === 'object' ? rows[0].value.version : rows[0].value;
      currentVersion = Number(v) || 0;
    }
  } catch { /* app_settings may not exist yet — fall through */ }
  if (currentVersion >= BACKFILL_VERSION) {
    return { skipped: true, currentVersion };
  }

  // ── Resolve HRX UUID by slug (survives UI renames) ───────────────────────
  let hrxId;
  try {
    const { rows } = await query(
      `SELECT id FROM org_nodes WHERE slug = $1 LIMIT 1`,
      [HR_EXPERIENCE_SLUG],
    );
    hrxId = rows[0]?.id;
  } catch (err) {
    console.warn('[dept-backfill] HRX lookup failed:', err.message);
  }
  if (!hrxId) {
    return { skipped: true, reason: 'HRX node not found' };
  }

  // ── Stamp every existing row in every surface table ──────────────────────
  // Each UPDATE is independent; one failure doesn't roll back the others.
  // ONLY targets rows with org_node_id IS NULL — re-runs are no-ops.
  const perTable = {};
  for (const tbl of SURFACE_TABLES) {
    try {
      const res = await query(
        `UPDATE ${tbl} SET org_node_id = $1 WHERE org_node_id IS NULL`,
        [hrxId],
      );
      perTable[tbl] = res.rowCount || 0;
    } catch (err) {
      console.warn(`[dept-backfill] ${tbl} backfill failed:`, err.message);
      perTable[tbl] = `error: ${err.message}`;
    }
  }

  // ── Audit + sentinel ─────────────────────────────────────────────────────
  try {
    await query(
      `INSERT INTO org_audit
         (actor_email, action, target_kind, target_id, after_json, metadata)
       VALUES ('system-seed', 'dept.backfill_hrx', 'system', 'phase-11a', $1::jsonb, $2::jsonb)`,
      [
        JSON.stringify({ hrxId }),
        JSON.stringify({ version: BACKFILL_VERSION, perTable }),
      ],
    );
  } catch (err) {
    console.warn('[dept-backfill] audit insert failed:', err.message);
  }

  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, 'system-seed', NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [BACKFILL_KEY, JSON.stringify({ version: BACKFILL_VERSION })],
  );

  return { skipped: false, version: BACKFILL_VERSION, hrxId, perTable };
}

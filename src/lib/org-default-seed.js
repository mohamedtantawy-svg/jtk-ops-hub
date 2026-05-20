// ── Org default seed (Phase 0 — 2026-05-20) ────────────────────────────────
// Bootstraps the org structure on first boot after this deploy:
//
//   HR Experience   (department)
//     ├─ EOR Operations (team)
//     └─ Next-Gen HR    (team)
//
// All existing team_member_overrides rows get org_node_id = EOR Operations
// so day-one merges have everyone landing under the right node — admins then
// move people around manually (Phase 4 ships drag-and-drop for this).
//
// Phase 10b (v2, 2026-05-20): on top of the v1 bootstrap, sweep every active
// department with a `lead_email` and ensure that lead is seeded as the dept's
// Admin (override row + org_node_admins). Catches up the three depts mohamed
// stood up before auto-seed existed (Global Immigration, Payroll Operations,
// Benefits Operations) and any future ones created before this code shipped.
//
// Idempotent via the `org_default_seed_version` sentinel in app_settings, in
// line with the other *-seed.js modules. Manual edits to the seeded nodes
// (rename, recolor, etc.) are preserved across deploys — the seed only
// inserts a node if no node with the same slug exists.

import { query } from './db';
import { ensureLeadIsDeptAdmin } from './org-lead-admin-seed';

// v2 (2026-05-20, Phase 10b): bump triggers a one-shot backfill that seeds
// every existing department's `lead_email` as that dept's Admin via
// ensureLeadIsDeptAdmin. Idempotent; safe to re-run on a fully-seeded DB.
const SEED_VERSION = 2;
const SEED_KEY = 'org_default_seed_version';

// Canonical slugs for the bootstrap nodes. Re-running the seed looks rows
// up by slug, so renames in the UI don't trigger re-creation.
const HR_EXPERIENCE_SLUG = 'hr-experience';
const EOR_OPERATIONS_SLUG = 'eor-operations';
const NEXT_GEN_HR_SLUG = 'next-gen-hr';

export async function seedOrgDefaultIfNeeded() {
  // ── Version-marker check ────────────────────────────────────────────────
  let currentVersion = 0;
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SEED_KEY],
    );
    if (rows[0]?.value) {
      const v = typeof rows[0].value === 'object' ? rows[0].value.version : rows[0].value;
      currentVersion = Number(v) || 0;
    }
  } catch {
    // app_settings may not exist on a brand-new DB; fall through to seed.
  }
  if (currentVersion >= SEED_VERSION) {
    return { skipped: true, currentVersion };
  }

  // ── Insert default structure ────────────────────────────────────────────
  // Each upsert uses ON CONFLICT (slug) DO NOTHING so renames done via the
  // UI (which change `name` but keep `slug`) are preserved.
  const hrExpRes = await query(
    `INSERT INTO org_nodes
       (parent_id, kind, name, slug, description, color, icon, sort_order, created_by)
     VALUES (NULL, 'department', 'HR Experience', $1,
             'HR Operations department — the home of the HRX team.',
             '#7c3aed', 'bi-people-fill', 0, 'system-seed')
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [HR_EXPERIENCE_SLUG],
  );
  // If the INSERT was a no-op (row already exists from a prior partial seed)
  // we still need the id to wire children + members. Fetch it.
  let hrExperienceId = hrExpRes.rows[0]?.id;
  if (!hrExperienceId) {
    const { rows } = await query(
      `SELECT id FROM org_nodes WHERE slug = $1`,
      [HR_EXPERIENCE_SLUG],
    );
    hrExperienceId = rows[0]?.id;
  }
  if (!hrExperienceId) {
    return { skipped: true, reason: 'failed to obtain HR Experience id' };
  }

  const eorOpsRes = await query(
    `INSERT INTO org_nodes
       (parent_id, kind, name, slug, description, color, icon, sort_order, created_by)
     VALUES ($1, 'team', 'EOR Operations', $2,
             'Employer of Record operations across all regions.',
             '#1f74b3', 'bi-globe', 0, 'system-seed')
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [hrExperienceId, EOR_OPERATIONS_SLUG],
  );
  let eorOpsId = eorOpsRes.rows[0]?.id;
  if (!eorOpsId) {
    const { rows } = await query(
      `SELECT id FROM org_nodes WHERE slug = $1`,
      [EOR_OPERATIONS_SLUG],
    );
    eorOpsId = rows[0]?.id;
  }

  const nextGenRes = await query(
    `INSERT INTO org_nodes
       (parent_id, kind, name, slug, description, color, icon, sort_order, created_by)
     VALUES ($1, 'team', 'Next-Gen HR', $2,
             'Next-generation HR services — new product lines.',
             '#0ea5e9', 'bi-stars', 1, 'system-seed')
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [hrExperienceId, NEXT_GEN_HR_SLUG],
  );
  // Existence guard only — we don't need the id below.
  if (!nextGenRes.rows[0]?.id) {
    await query(`SELECT id FROM org_nodes WHERE slug = $1`, [NEXT_GEN_HR_SLUG]);
  }

  // ── Backfill member assignment ──────────────────────────────────────────
  // Every existing override row that has no org_node_id gets pointed at EOR
  // Operations. Members without an override row land in "Unassigned" on the
  // chart — the admin moves them once Phase 4 ships, or Phase 3's Edit
  // Allocation modal upserts an override row on first edit.
  let backfilledOverrides = 0;
  if (eorOpsId) {
    const upd = await query(
      `UPDATE team_member_overrides
          SET org_node_id = $1, updated_at = NOW()
        WHERE org_node_id IS NULL
          AND (is_deleted IS NULL OR is_deleted = false)`,
      [eorOpsId],
    );
    backfilledOverrides = upd.rowCount || 0;
  }

  // ── v2 (Phase 10b): seed lead-as-admin for every existing department ────
  // Iterates every active department with a non-null lead_email and ensures
  // (a) the lead has an override row pointing at the dept with access='admin',
  // (b) the lead is in org_node_admins for that dept. Idempotent via the
  // helper's UPSERT/ON CONFLICT semantics. Skipped when the sentinel is
  // already at v2 (early-return at top of function).
  let leadAdminsSeeded = 0;
  if (currentVersion < 2) {
    try {
      const { rows: depts } = await query(
        `SELECT id, lead_email FROM org_nodes
           WHERE kind = 'department'
             AND is_archived = false
             AND lead_email IS NOT NULL
             AND lead_email <> ''`,
      );
      for (const d of depts) {
        try {
          await ensureLeadIsDeptAdmin({
            nodeId: d.id,
            leadEmail: d.lead_email,
            actorEmail: 'system-seed',
          });
          leadAdminsSeeded += 1;
        } catch (err) {
          console.warn(`[org seed v2] lead-as-admin backfill failed for ${d.id}/${d.lead_email}:`, err?.message);
        }
      }
    } catch (err) {
      console.warn('[org seed v2] backfill loop failed:', err?.message);
    }
  }

  // ── Audit row for the bootstrap ─────────────────────────────────────────
  await query(
    `INSERT INTO org_audit (actor_email, action, target_kind, target_id, after_json, metadata)
     VALUES ('system-seed', 'org.bootstrap', 'system', 'phase-0', $1::jsonb, $2::jsonb)`,
    [
      JSON.stringify({
        hr_experience_id: hrExperienceId,
        eor_operations_id: eorOpsId,
      }),
      JSON.stringify({
        version: SEED_VERSION,
        backfilled_overrides: backfilledOverrides,
        lead_admins_seeded: leadAdminsSeeded,
      }),
    ],
  );

  // ── Mark sentinel ───────────────────────────────────────────────────────
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, 'system-seed', NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [SEED_KEY, JSON.stringify({ version: SEED_VERSION })],
  );

  return {
    skipped: false,
    version: SEED_VERSION,
    hr_experience_id: hrExperienceId,
    eor_operations_id: eorOpsId,
    backfilled_overrides: backfilledOverrides,
    lead_admins_seeded: leadAdminsSeeded,
  };
}

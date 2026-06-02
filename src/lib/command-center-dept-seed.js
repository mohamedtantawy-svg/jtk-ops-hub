// ── Command Center department seed (2026-06-03) ─────────────────────────────
// The executive Command Center is a top-level DEPARTMENT in the Org tab — a real
// org_nodes row (slug 'command-center') alongside HR Experience / GIX / Payroll /
// Benefits / G&A People — with its own members. When a member's effective dept is
// this node (or the super-admin switches into it), App.jsx renders the dedicated
// CommandCenterApp (its own Home + report tabs) instead of the standard ops views.
//
// This seed (idempotent via the `command_center_dept_seed_version` sentinel):
//   1. Creates the Command Center department node if missing (looked up by slug,
//      so a UI rename is preserved). sort_order is negative so it sits ON TOP of
//      the operational departments in the Org chart.
//   2. Seeds the leadership roster (carlos@, kento.arrue@) as members of it —
//      access 'admin' so they read the cross-department rollups, placed in the CC
//      dept so they land in the Command Center app on login. ON CONFLICT DO NOTHING
//      so an existing roster row is never clobbered. mohamed is the global
//      super-admin and reaches the CC via the dept picker — not seeded as a member.
//
// The CC department is the OBSERVER, not an observed dept: the aggregator excludes
// slug 'command-center' from the cross-department rollup (it has no ops data).

import { query } from './db';

const SEED_VERSION = 1;
const SEED_KEY = 'command_center_dept_seed_version';

export const COMMAND_CENTER_DEPT_SLUG = 'command-center';

// Leadership members seeded into the Command Center department. Mirrors the
// (retired) workspace registry's COMMAND_CENTER_EMAILS minus mohamed (super-admin).
const CC_MEMBERS = [
  { email: 'carlos@deel.com',       name: 'Carlos',        title: 'VP of Operations' },
  { email: 'kento.arrue@deel.com',  name: 'Kento Arrue',   title: 'Operations Leadership' },
];

export async function seedCommandCenterDeptIfNeeded() {
  let currentVersion = 0;
  try {
    const { rows } = await query(`SELECT value FROM app_settings WHERE key = $1`, [SEED_KEY]);
    if (rows[0]?.value) {
      const v = typeof rows[0].value === 'object' ? rows[0].value.version : rows[0].value;
      currentVersion = Number(v) || 0;
    }
  } catch {
    // app_settings may not exist yet on a brand-new DB — fall through to seed.
  }
  if (currentVersion >= SEED_VERSION) return { skipped: true, currentVersion };

  // 1. Department node (look up by slug; preserve UI renames via ON CONFLICT).
  const insRes = await query(
    `INSERT INTO org_nodes
       (parent_id, kind, name, slug, description, color, icon, sort_order, created_by)
     VALUES (NULL, 'department', 'Command Center', $1,
             'Executive cross-department oversight for the CEO / VP Ops / COO.',
             '#7c3aed', 'bi-speedometer2', -10, 'system-seed')
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [COMMAND_CENTER_DEPT_SLUG],
  );
  let deptId = insRes.rows[0]?.id;
  if (!deptId) {
    const { rows } = await query(`SELECT id FROM org_nodes WHERE slug = $1`, [COMMAND_CENTER_DEPT_SLUG]);
    deptId = rows[0]?.id;
  }
  if (!deptId) return { skipped: true, reason: 'failed to obtain Command Center dept id' };

  // 2. Seed leadership members (never clobber an existing roster row).
  let membersSeeded = 0;
  for (const m of CC_MEMBERS) {
    try {
      const res = await query(
        `INSERT INTO team_member_overrides (email, name, title, access, org_node_id, is_new, is_deleted)
         VALUES ($1, $2, $3, 'admin', $4, true, false)
         ON CONFLICT (email) DO NOTHING`,
        [m.email.toLowerCase(), m.name, m.title, deptId],
      );
      membersSeeded += res.rowCount || 0;
    } catch (err) {
      console.warn(`[command-center-dept-seed] member seed failed for ${m.email}:`, err?.message);
    }
  }

  // Audit + sentinel.
  try {
    await query(
      `INSERT INTO org_audit (actor_email, action, target_kind, target_id, after_json, metadata)
       VALUES ('system-seed', 'org.command_center_dept', 'node', $1, $2::jsonb, $3::jsonb)`,
      [String(deptId), JSON.stringify({ deptId, slug: COMMAND_CENTER_DEPT_SLUG }), JSON.stringify({ version: SEED_VERSION, membersSeeded })],
    );
  } catch (err) {
    console.warn('[command-center-dept-seed] audit insert failed:', err?.message);
  }
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, 'system-seed', NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [SEED_KEY, JSON.stringify({ version: SEED_VERSION })],
  );

  return { skipped: false, version: SEED_VERSION, deptId, membersSeeded };
}

// One-time seed: copy the file-based workspace allowlists
// (src/workspaces/<team>/data/allowlist.js) into the workspace_members DB
// table on first boot after this deploy.
//
// Versioning follows the same pattern as country-owners-seed / hr-hub-seed:
// a sentinel row in app_settings prevents double-seeding when multiple pods
// boot simultaneously. Bumping SEED_VERSION re-applies the seed for fresh
// deploys; existing rows are preserved via ON CONFLICT DO NOTHING.

import { query } from './db';
import { PAYROLL_ALLOWED_EMAILS, PAYROLL_ADMINS } from '../workspaces/payroll/data/allowlist';
import { GIX_ALLOWED_EMAILS, GIX_ADMINS } from '../workspaces/gix/data/allowlist';

const SEED_VERSION = 1;
const SEED_KEY = 'workspace_members_seed_version';

// Command Center has a tiny hardcoded roster (leadership view). Keeping it
// inline rather than importing from the registry to avoid a circular reach
// (registry → server lib → registry).
const COMMAND_CENTER_EMAILS = [
  'carlos@deel.com',
  'kento.arrue@deel.com',
  'mohamed.tantawy@deel.com',
];
const COMMAND_CENTER_ADMINS = ['mohamed.tantawy@deel.com'];

function dedupe(arr) {
  return Array.from(new Set(arr.map(e => e.trim().toLowerCase())));
}

function buildSeedRows() {
  const rows = [];
  const ccEmails = dedupe(COMMAND_CENTER_EMAILS);
  const ccAdmins = new Set(COMMAND_CENTER_ADMINS.map(e => e.toLowerCase()));
  for (const email of ccEmails) {
    rows.push({ workspace_id: 'command-center', email, role: ccAdmins.has(email) ? 'admin' : 'member' });
  }

  const payrollEmails = dedupe(PAYROLL_ALLOWED_EMAILS);
  const payrollAdmins = new Set(PAYROLL_ADMINS.map(e => e.toLowerCase()));
  for (const email of payrollEmails) {
    rows.push({ workspace_id: 'payroll', email, role: payrollAdmins.has(email) ? 'admin' : 'member' });
  }

  const gixEmails = dedupe(GIX_ALLOWED_EMAILS);
  const gixAdmins = new Set(GIX_ADMINS.map(e => e.toLowerCase()));
  for (const email of gixEmails) {
    rows.push({ workspace_id: 'gix', email, role: gixAdmins.has(email) ? 'admin' : 'member' });
  }
  return rows;
}

export async function seedWorkspaceMembersIfNeeded() {
  // Check version sentinel
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
  } catch (err) {
    // app_settings may not exist on a brand-new DB — first run will create it
    // alongside this seed. Fall through to seed.
  }
  if (currentVersion >= SEED_VERSION) {
    return { skipped: true, currentVersion };
  }

  const seedRows = buildSeedRows();
  if (!seedRows.length) {
    return { skipped: true, reason: 'empty allowlists' };
  }

  // Bulk insert in chunks of 500 to keep query payload + DB transaction
  // memory bounded (1,389 rows is fine, but defensively chunked in case
  // the rosters grow). ON CONFLICT respects the partial unique index on
  // (workspace_id, LOWER(email)) WHERE status='active' so re-seeding
  // never duplicates active rows.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < seedRows.length; i += CHUNK) {
    const chunk = seedRows.slice(i, i + CHUNK);
    const values = chunk
      .map((_, idx) => `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`)
      .join(', ');
    const params = chunk.flatMap(r => [r.workspace_id, r.email, r.role, 'system-seed']);
    const res = await query(
      `INSERT INTO workspace_members (workspace_id, email, role, added_by)
       VALUES ${values}
       ON CONFLICT DO NOTHING
       RETURNING id`,
      params,
    );
    inserted += res.rowCount || 0;
  }

  // Mark sentinel
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, 'system-seed', NOW())
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [SEED_KEY, JSON.stringify({ version: SEED_VERSION })],
  );

  return { skipped: false, version: SEED_VERSION, inserted, totalCandidates: seedRows.length };
}

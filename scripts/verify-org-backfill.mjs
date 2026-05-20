// ── Org backfill verification harness (Phase 0 — 2026-05-20) ───────────────
// Runs without a database. Exercises the deterministic side of the Phase 0
// migration:
//   • SCHEMA_SQL in src/lib/migrate.js declares org_nodes, org_vacant_roles,
//     org_node_admins, org_audit + the ALTER TABLE on team_member_overrides.
//   • src/lib/org-default-seed.js exists and exports the expected entry point.
//   • src/lib/team-members-merge.js threads `orgNodeId` into the merged output.
//   • app/api/v1/team-members/route.js selects org_node_id.
//   • src/data/accessControl.js registers 'org' in ALL_VIEWS + VIEW_LABELS.
//   • src/components/nav/DeelTopNav.jsx has an 'org' entry in PRIMARY_TABS.
//   • src/components/views/OrgView.jsx exists.
//
// Usage:  node scripts/verify-org-backfill.mjs
//
// Exits 0 if everything passes, non-zero with a printed report otherwise.
// The DB-side verification (every member has org_node_id, no orphans, no
// cycles) lands as a follow-up admin endpoint in Phase 1 — once the org
// API exists, we wire it from the Settings panel.

import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function assert(label, actual, expected = true) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

const root = new URL('..', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf-8');

// ── Section 1: migrate.js declares the new schema ────────────────────────
console.log('\n── migrate.js: schema additions ──');
const migrateSrc = read('src/lib/migrate.js');
assert('CREATE TABLE org_nodes',          migrateSrc.includes('CREATE TABLE IF NOT EXISTS org_nodes'));
assert('CREATE TABLE org_vacant_roles',   migrateSrc.includes('CREATE TABLE IF NOT EXISTS org_vacant_roles'));
assert('CREATE TABLE org_node_admins',    migrateSrc.includes('CREATE TABLE IF NOT EXISTS org_node_admins'));
assert('CREATE TABLE org_audit',          migrateSrc.includes('CREATE TABLE IF NOT EXISTS org_audit'));
assert('kind CHECK accepts department + team',
  /CHECK \(kind IN \('department','team'\)\)/.test(migrateSrc));
assert('parent_id FK uses ON DELETE RESTRICT',
  /parent_id\s+UUID\s+REFERENCES\s+org_nodes\(id\)\s+ON\s+DELETE\s+RESTRICT/.test(migrateSrc));
assert('uniq_org_nodes_sibling_name index protects sibling names',
  migrateSrc.includes('uniq_org_nodes_sibling_name'));
assert('ALTER TABLE adds org_node_id to team_member_overrides',
  /ALTER TABLE team_member_overrides[\s\S]+ADD COLUMN IF NOT EXISTS org_node_id/.test(migrateSrc));
assert('seedOrgDefaultIfNeeded imported',
  migrateSrc.includes("from './org-default-seed'"));
assert('seedOrgDefaultIfNeeded invoked in runMigrations',
  migrateSrc.includes('seedOrgDefaultIfNeeded()'));

// ── Section 2: org-default-seed.js exists and is shaped right ────────────
console.log('\n── org-default-seed.js: bootstrap structure ──');
const seedSrc = read('src/lib/org-default-seed.js');
assert('exports seedOrgDefaultIfNeeded',
  /export async function seedOrgDefaultIfNeeded/.test(seedSrc));
assert('declares SEED_VERSION sentinel',
  /SEED_VERSION\s*=\s*\d+/.test(seedSrc));
assert('SEED_KEY matches `org_default_seed_version`',
  seedSrc.includes("'org_default_seed_version'"));
assert('inserts HR Experience department',
  /'HR Experience'/.test(seedSrc) && seedSrc.includes("'hr-experience'"));
assert('inserts EOR Operations team',
  /'EOR Operations'/.test(seedSrc) && seedSrc.includes("'eor-operations'"));
assert('inserts Next-Gen HR team',
  /'Next-Gen HR'/.test(seedSrc) && seedSrc.includes("'next-gen-hr'"));
assert('backfill UPDATE targets overrides without org_node_id',
  /UPDATE team_member_overrides[\s\S]+SET org_node_id[\s\S]+WHERE org_node_id IS NULL/.test(seedSrc));
assert('writes a bootstrap audit row',
  /INSERT INTO org_audit[\s\S]+'org.bootstrap'/.test(seedSrc));

// ── Section 3: merge surfaces orgNodeId ──────────────────────────────────
console.log('\n── team-members-merge.js: orgNodeId threading ──');
const mergeSrc = read('src/lib/team-members-merge.js');
assert('normaliseOverrideRow extracts org_node_id → orgNodeId',
  /orgNodeId:\s*row\.org_node_id\s*\|\|\s*null/.test(mergeSrc));
assert('applyOverride no-override branch defaults orgNodeId: null',
  /isLeaderAlertsAdmin:\s*false,\s*orgNodeId:\s*null/.test(mergeSrc));
assert('applyOverride override branch assigns merged.orgNodeId',
  /merged\.orgNodeId\s*=\s*override\.orgNodeId/.test(mergeSrc));
assert('brand-new branch carries orgNodeId from override',
  /isLeaderAlertsAdmin:\s*override\.isLeaderAlertsAdmin\s*===\s*true,\s*orgNodeId:\s*override\.orgNodeId\s*\|\|\s*null/.test(mergeSrc));

// ── Section 4: GET /team-members surfaces the column ─────────────────────
console.log('\n── team-members route: SELECT org_node_id ──');
const routeSrc = read('app/api/v1/team-members/route.js');
assert('GET selects org_node_id from team_member_overrides',
  /SELECT[\s\S]+org_node_id[\s\S]+FROM team_member_overrides/.test(routeSrc));

// ── Section 5: accessControl registers the view ──────────────────────────
console.log('\n── accessControl.js: org view registration ──');
const aclSrc = read('src/data/accessControl.js');
assert("ALL_VIEWS contains 'org'",
  /'org',\s*\n\s*'settings'/.test(aclSrc));
assert("VIEW_LABELS contains 'org': 'Org'",
  /'org':\s*'Org'/.test(aclSrc));
assert("'org' is NOT in MANAGERIAL_ONLY_VIEWS (visible to agents)",
  /MANAGERIAL_ONLY_VIEWS\s*=\s*new\s+Set\(\[\s*['"](?:leader-alerts|team|lead-home|urgent-assist-schedule)['"](?:,\s*['"](?:leader-alerts|team|lead-home|urgent-assist-schedule)['"])*\s*\]\)/.test(aclSrc));
assert("'can_manage_org' admin power declared",
  /'can_manage_org'/.test(aclSrc));

// ── Section 6: primary nav exposes the tab ───────────────────────────────
console.log('\n── DeelTopNav.jsx: org tab in PRIMARY_TABS ──');
const navSrc = read('src/components/nav/DeelTopNav.jsx');
assert("PRIMARY_TABS has an entry with id 'org'",
  /\{\s*id:\s*'org'/.test(navSrc));
assert('Org tab uses bi-diagram-3 icon',
  /id:\s*'org'[\s\S]{0,160}icon:\s*'bi-diagram-3'/.test(navSrc));
assert('Org tab is NOT managerialOnly (visible to agents)',
  !/id:\s*'org'[\s\S]{0,200}managerialOnly:\s*true/.test(navSrc));

// ── Section 7: OrgView shell exists and is imported in App.jsx ───────────
console.log('\n── OrgView mount ──');
const orgViewSrc = read('src/components/views/OrgView.jsx');
assert('OrgView default exports a component',
  /export default function OrgView/.test(orgViewSrc));
assert('OrgView consumes PermissionsContext',
  /useContext\(PermissionsContext\)/.test(orgViewSrc));
const appSrc = read('src/App.jsx');
assert("App.jsx imports OrgView",
  /import\s+OrgView\s+from\s+'\.\/components\/views\/OrgView'/.test(appSrc));
assert("App.jsx renders <OrgView> when view==='org'",
  /view==='org'[\s\S]{0,200}<OrgView/.test(appSrc));

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

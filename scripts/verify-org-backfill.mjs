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

// ── Section 8: Phase 1 CRUD wiring ───────────────────────────────────────
console.log('\n── Phase 1: CRUD wiring ──');
const orgAdminSrc = read('src/lib/org-admin.js');
assert('org-admin exports canManageOrgGlobal',
  /export function canManageOrgGlobal/.test(orgAdminSrc));
assert('org-admin exports canManageOrgNode',
  /export async function canManageOrgNode/.test(orgAdminSrc));
assert('canManageOrgGlobal grants admin + regional_manager',
  /role === 'admin' \|\| user\.role === 'regional_manager'/.test(orgAdminSrc));
assert('delegation walks ancestors via recursive CTE',
  /WITH RECURSIVE chain[\s\S]+org_node_admins/.test(orgAdminSrc));

const nodesRouteSrc = read('app/api/v1/org/nodes/route.js');
assert('GET /org/nodes uses getAuthUser',
  /export async function GET[\s\S]+getAuthUser/.test(nodesRouteSrc));
assert('POST validates kind enum',
  /VALID_KINDS\s*=\s*new\s+Set\(\[\s*'department',\s*'team'/.test(nodesRouteSrc));
assert('POST enforces team-must-have-parent rule',
  /A team must have a parent department/.test(nodesRouteSrc));
assert('POST applies depth cap',
  /MAX_DEPTH\s*=\s*6/.test(nodesRouteSrc) && /Hierarchy depth cap/.test(nodesRouteSrc));
assert('POST writes org_audit',
  /INSERT INTO org_audit[\s\S]+'node\.create'/.test(nodesRouteSrc));

const nodeByIdSrc = read('app/api/v1/org/nodes/[id]/route.js');
assert('PATCH refuses to mutate archived nodes',
  /Restore the node before editing/.test(nodeByIdSrc));
assert('DELETE refuses when node has children or members',
  /Cannot archive a node with active children or members/.test(nodeByIdSrc));
assert('DELETE is soft-delete (sets is_archived = true)',
  /SET is_archived = true/.test(nodeByIdSrc));

const moveSrc = read('app/api/v1/org/nodes/[id]/move/route.js');
assert('move endpoint prevents cycles',
  /Cannot move a node inside its own descendants \(cycle\)/.test(moveSrc));
assert('move endpoint guards depth cap',
  /Move would exceed hierarchy depth cap/.test(moveSrc));

const orgApiSrc = read('src/services/orgApi.js');
assert('orgApi exports the 6 CRUD wrappers',
  /listOrgNodes/.test(orgApiSrc)
    && /createOrgNode/.test(orgApiSrc)
    && /patchOrgNode/.test(orgApiSrc)
    && /archiveOrgNode/.test(orgApiSrc)
    && /moveOrgNode/.test(orgApiSrc)
    && /reorderOrgNode/.test(orgApiSrc));

const useOrgNodesSrc = read('src/hooks/useOrgNodes.js');
assert('useOrgNodes builds a parent → children tree',
  /buildTree[\s\S]+byParent/.test(useOrgNodesSrc));
assert('useOrgNodes exposes sumDescendants for recursive headcount',
  /sumDescendants/.test(useOrgNodesSrc));

const orgTreeSrc = read('src/components/org/OrgTreeView.jsx');
assert('OrgTreeView persists collapse state to localStorage',
  /ops_hub_org_collapsed/.test(orgTreeSrc));
assert('OrgTreeView search auto-expands matching ancestors',
  /keepIds/.test(orgTreeSrc));

const drawerSrc = read('src/components/org/OrgNodeFormDrawer.jsx');
assert('drawer handles create AND edit',
  /mode === 'edit'/.test(drawerSrc) && /mode === 'create'/.test(drawerSrc));
assert('drawer offers color presets',
  /PRESET_COLORS/.test(drawerSrc));
assert('drawer offers icon presets',
  /PRESET_ICONS/.test(drawerSrc));

const archiveSrc = read('src/components/org/OrgArchiveConfirm.jsx');
assert('archive confirm reads err.body.impact',
  /err\?\.body\?\.impact/.test(archiveSrc));

const orgViewSrcPhase1 = read('src/components/views/OrgView.jsx');
assert('OrgView mounts useOrgNodes',
  /useOrgNodes\(\)/.test(orgViewSrcPhase1));
assert('OrgView mounts the create/edit drawer',
  /<OrgNodeFormDrawer/.test(orgViewSrcPhase1));
assert('OrgView mounts the archive confirm',
  /<OrgArchiveConfirm/.test(orgViewSrcPhase1));
assert('OrgView renders the tree view when nodes exist',
  /<OrgTreeView/.test(orgViewSrcPhase1));

// ── Section 9: Phase 2 visual chart ─────────────────────────────────────
console.log('\n── Phase 2: visual chart ──');
const layoutSrc = read('src/utils/orgChartLayout.js');
assert('layout exports layoutOrgChart',
  /export function layoutOrgChart/.test(layoutSrc));
assert('layout produces positioned items with parent + member kinds',
  /kind:\s*'node'/.test(layoutSrc) && /kind:\s*'member'/.test(layoutSrc));
assert('layout caps inline members per node (MAX_INLINE_MEMBERS)',
  /MAX_INLINE_MEMBERS\s*=\s*\d+/.test(layoutSrc));
assert('layout sorts members alphabetically before placement',
  /localeCompare/.test(layoutSrc));

const canvasSrc = read('src/components/org/OrgChartCanvas.jsx');
assert('canvas applies pan via pointer events',
  /onPointerDown[\s\S]+startPan/.test(canvasSrc));
assert('canvas supports cmd/ctrl + wheel zoom',
  /metaKey \|\| e\.ctrlKey/.test(canvasSrc));
assert('canvas exposes fit-to-screen',
  /Fit-to-screen/.test(canvasSrc) || /'Fit'/.test(canvasSrc));
assert('canvas renders SVG connectors between parent and child cards',
  /<svg[\s\S]+connectors\.map/.test(canvasSrc));
assert('NodeCard renders headcount badge',
  /node\.memberCount/.test(canvasSrc));
assert('NodeCard offers Edit / Add team / Archive when canEdit',
  /Edit[\s\S]+Add team[\s\S]+Archive/.test(canvasSrc));
assert('MemberCard imports Avatar',
  /import Avatar from/.test(canvasSrc));

const orgViewSrcPhase2 = read('src/components/views/OrgView.jsx');
assert('OrgView mounts OrgChartCanvas in chart mode',
  /viewMode === 'chart'[\s\S]+<OrgChartCanvas/.test(orgViewSrcPhase2));
assert('OrgView keeps the indented list mode',
  /viewMode === 'list'[\s\S]+<OrgTreeView/.test(orgViewSrcPhase2));
assert('OrgView VIEW_MODES has 3 entries',
  (orgViewSrcPhase2.match(/\{\s*id:\s*'(chart|list|table)'/g) || []).length === 3);

// ── Section 10: Phase 3 people management ────────────────────────────────
console.log('\n── Phase 3: people management migration ──');
const memberDrawerSrc = read('src/components/org/MemberDetailDrawer.jsx');
assert('MemberDetailDrawer exports default',
  /export default function MemberDetailDrawer/.test(memberDrawerSrc));
assert('drawer integrates with useTeamMembers update/remove/toggleLeave/setCountries',
  /onUpdate[\s\S]+onRemove[\s\S]+onToggleLeave[\s\S]+onSetCountries/.test(memberDrawerSrc));
assert('drawer ships a cascading NodePicker for allocation',
  /function NodePicker/.test(memberDrawerSrc));

const addMemberSrc = read('src/components/org/AddMemberModal.jsx');
assert('AddMemberModal posts orgNodeId in the payload',
  /orgNodeId:\s*node\.id/.test(addMemberSrc));
assert('AddMemberModal validates @deel.com domain',
  /endsWith\('@deel\.com'\)/.test(addMemberSrc));

const teamMembersByIdSrc = read('app/api/v1/team-members/[email]/route.js');
assert('PATCH whitelists orgNodeId → org_node_id',
  /orgNodeId:\s*'org_node_id'/.test(teamMembersByIdSrc));
assert('PATCH RETURNING includes org_node_id',
  /RETURNING[\s\S]+org_node_id/.test(teamMembersByIdSrc));
assert('PATCH response carries orgNodeId',
  /orgNodeId:\s*row\.org_node_id/.test(teamMembersByIdSrc));

const teamMembersPostSrc = read('app/api/v1/team-members/route.js');
assert('POST validates orgNodeId UUID and inserts it',
  /\/\^\[0-9a-fA-F-\]\{36\}\$\//.test(teamMembersPostSrc));
assert('POST INSERT statement carries org_node_id',
  /org_node_id\b[\s\S]+VALUES[\s\S]+\$13/.test(teamMembersPostSrc));

const orgViewSrcPhase3 = read('src/components/views/OrgView.jsx');
assert('OrgView mounts MemberDetailDrawer',
  /<MemberDetailDrawer/.test(orgViewSrcPhase3));
assert('OrgView mounts AddMemberModal',
  /<AddMemberModal/.test(orgViewSrcPhase3));
assert('OrgView wires onSelectMember to setSelectedMember',
  /onSelectMember=\{[^}]*setSelectedMember/.test(orgViewSrcPhase3));
assert('OrgView wires onAddMember to setAddMemberTo on both chart and list',
  (orgViewSrcPhase3.match(/onAddMember=\{[^}]*setAddMemberTo/g) || []).length >= 2);

const leadersHubSrc = read('src/components/views/LeadersHubView.jsx');
assert('Leaders Hub no longer imports Team',
  !/^import Team from/m.test(leadersHubSrc));
assert('Leaders Hub no longer declares a SUBTABS array',
  !/^const SUBTABS\s*=/m.test(leadersHubSrc));

const appSrc2 = read('src/App.jsx');
assert("App.jsx aliases legacy 'team' deep-link to 'org'",
  /'team':\s*'org'/.test(appSrc2));

// ── Section 11: Phase 4 drag-and-drop + bulk move ────────────────────────
console.log('\n── Phase 4: DnD + bulk move ──');
const movePreviewSrc = read('src/components/org/OrgMovePreviewModal.jsx');
assert('move preview modal exists',
  /export default function OrgMovePreviewModal/.test(movePreviewSrc));
assert('move preview surfaces bulk vs single copy',
  /isBulk/.test(movePreviewSrc));

const bulkBarSrc = read('src/components/org/BulkMoveBar.jsx');
assert('BulkMoveBar exports default',
  /export default function BulkMoveBar/.test(bulkBarSrc));
assert('BulkMoveBar renders target-tree picker',
  /TargetTree/.test(bulkBarSrc));

const canvasSrcPhase4 = read('src/components/org/OrgChartCanvas.jsx');
assert('chart canvas tracks drag source + target',
  /dragSourceEmails/.test(canvasSrcPhase4) && /dragTargetId/.test(canvasSrcPhase4));
assert('NodeCard exposes drop handlers + drop-target visual',
  /isDropTarget/.test(canvasSrcPhase4) && /onDrop=/.test(canvasSrcPhase4));
assert('MemberCard is draggable when canEdit',
  /draggable=\{!!canEdit\}/.test(canvasSrcPhase4));
assert('MemberCard cmd/ctrl/shift-click toggles selection',
  /metaKey \|\| e\.ctrlKey \|\| e\.shiftKey/.test(canvasSrcPhase4));

const orgViewSrcPhase4 = read('src/components/views/OrgView.jsx');
assert('OrgView holds selectedEmails state',
  /selectedEmails,\s*setSelectedEmails/.test(orgViewSrcPhase4));
assert('OrgView mounts OrgMovePreviewModal',
  /<OrgMovePreviewModal/.test(orgViewSrcPhase4));
assert('OrgView mounts BulkMoveBar gated on canEdit',
  /canEdit && \([\s\S]+<BulkMoveBar/.test(orgViewSrcPhase4));
assert('OrgView applyMove iterates updateMember with orgNodeId',
  /tm\.updateMember\(m\.email,\s*\{\s*orgNodeId:\s*target\.id/.test(orgViewSrcPhase4));

// ── Section 12: Phase 5 per-team configuration ───────────────────────────
console.log('\n── Phase 5: per-team config ──');
const adminsRouteSrc = read('app/api/v1/org/nodes/[id]/admins/route.js');
assert('admins route exposes GET/POST/DELETE',
  /export async function GET/.test(adminsRouteSrc)
  && /export async function POST/.test(adminsRouteSrc)
  && /export async function DELETE/.test(adminsRouteSrc));
assert('admins grant writes org_audit',
  /'node\.admin\.grant'/.test(adminsRouteSrc));
assert('admins revoke writes org_audit',
  /'node\.admin\.revoke'/.test(adminsRouteSrc));
assert('admins grant busts the org-admin cache',
  /bustOrgAdminCache/.test(adminsRouteSrc));

const vacanciesRouteSrc = read('app/api/v1/org/nodes/[id]/vacancies/route.js');
assert('vacancies route exposes GET/POST/DELETE',
  /export async function GET/.test(vacanciesRouteSrc)
  && /export async function POST/.test(vacanciesRouteSrc)
  && /export async function DELETE/.test(vacanciesRouteSrc));
assert('vacancies POST writes audit',
  /'vacancy\.create'/.test(vacanciesRouteSrc));

const slaResolverSrc = read('src/lib/sla-resolver.js');
assert('SLA resolver walks ancestors with safety guard',
  /while \(cur && safety < 32\)/.test(slaResolverSrc));
assert('SLA resolver merges outermost → innermost',
  /reverse\(\)/.test(slaResolverSrc));

const orgApiSrcPhase5 = read('src/services/orgApi.js');
assert('orgApi adds delegated-admin wrappers',
  /listNodeAdmins/.test(orgApiSrcPhase5)
  && /grantNodeAdmin/.test(orgApiSrcPhase5)
  && /revokeNodeAdmin/.test(orgApiSrcPhase5));
assert('orgApi adds vacancy wrappers',
  /listNodeVacancies/.test(orgApiSrcPhase5)
  && /addNodeVacancy/.test(orgApiSrcPhase5)
  && /removeNodeVacancy/.test(orgApiSrcPhase5));

const drawerSrcPhase5 = read('src/components/org/OrgNodeFormDrawer.jsx');
assert('drawer surfaces SLA cascade inputs',
  /SLA override \(minutes\)/.test(drawerSrcPhase5));
assert('drawer surfaces dashboards stub',
  /Dashboard slugs/.test(drawerSrcPhase5));
assert('drawer renders DelegatedAdminsSection',
  /<DelegatedAdminsSection/.test(drawerSrcPhase5));
assert('drawer renders VacanciesSection',
  /<VacanciesSection/.test(drawerSrcPhase5));
assert('save folds SLA + dashboards into config blob',
  /config:\s*cleanConfig/.test(drawerSrcPhase5));

// ── Section 13: Phase 6 downstream wiring ────────────────────────────────
console.log('\n── Phase 6: downstream wiring ──');
const orgScopeSrc = read('src/lib/org-scope.js');
assert('org-scope exports subtreeNodeIds + membersInSubtree + userOrgScope',
  /export function subtreeNodeIds/.test(orgScopeSrc)
  && /export function membersInSubtree/.test(orgScopeSrc)
  && /export function userOrgScope/.test(orgScopeSrc));
assert('subtreeNodeIds caps iterations to prevent infinite loops',
  /safety < 5000/.test(orgScopeSrc));

const tmRouteSrcPhase6 = read('app/api/v1/team-members/route.js');
assert('POST team-members validates against dynamic team list',
  /getValidTeamNames\(\)/.test(tmRouteSrcPhase6));
assert('POST keeps legacy enum as fallback',
  /LEGACY_VALID_TEAMS/.test(tmRouteSrcPhase6));

const tmByIdSrcPhase6 = read('app/api/v1/team-members/[email]/route.js');
assert('PATCH team-members validates against dynamic team list',
  /getValidTeamNamesForPatch/.test(tmByIdSrcPhase6));

const orgConfigSrc = read('src/data/orgConfig.js');
assert('orgConfig.js marked @deprecated',
  /@deprecated/.test(orgConfigSrc));

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

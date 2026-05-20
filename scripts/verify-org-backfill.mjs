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

// ── Section 14: Phase 7 audit + CSV export ───────────────────────────────
console.log('\n── Phase 7: audit viewer + CSV export ──');
const auditRouteSrc = read('app/api/v1/org/audit/route.js');
assert('audit route admin-gated (canManageOrgGlobal)',
  /canManageOrgGlobal\(user\)/.test(auditRouteSrc));
assert('audit route supports limit + filters',
  /MAX_LIMIT/.test(auditRouteSrc) && /action[\s\S]+actor[\s\S]+target/.test(auditRouteSrc));

const auditDrawerSrc = read('src/components/org/OrgAuditDrawer.jsx');
assert('audit drawer exports default',
  /export default function OrgAuditDrawer/.test(auditDrawerSrc));
assert('audit drawer labels common actions',
  /node\.create[\s\S]+node\.update[\s\S]+node\.archive/.test(auditDrawerSrc));

const csvSrc = read('src/utils/orgCsvExport.js');
assert('csv exports buildStructureCsv',
  /export function buildStructureCsv/.test(csvSrc));
assert('csv exports buildMembersCsv',
  /export function buildMembersCsv/.test(csvSrc));
assert('csv exports downloadCsv (Blob + a.click)',
  /URL\.createObjectURL/.test(csvSrc) && /a\.click\(\)/.test(csvSrc));

const orgViewSrcPhase7 = read('src/components/views/OrgView.jsx');
assert('OrgView mounts OrgAuditDrawer',
  /<OrgAuditDrawer/.test(orgViewSrcPhase7));
assert('OrgView wires audit button',
  /onClick=\{\(\) => setAuditOpen\(true\)\}/.test(orgViewSrcPhase7));
assert('OrgView exposes structure + members CSV exports',
  /buildStructureCsv/.test(orgViewSrcPhase7) && /buildMembersCsv/.test(orgViewSrcPhase7));

// ── Section 15: Phase 8 hardening + restore ──────────────────────────────
console.log('\n── Phase 8: hardening ──');
const restoreSrc = read('app/api/v1/org/nodes/[id]/restore/route.js');
assert('restore endpoint flips is_archived = false',
  /is_archived = false/.test(restoreSrc));
assert('restore refuses when parent is archived',
  /Parent node is archived/.test(restoreSrc));
assert('restore guards against sibling-name collision',
  /A sibling with the same name now exists/.test(restoreSrc));
assert('restore writes node.restore audit',
  /'node\.restore'/.test(restoreSrc));

const orgApiSrcPhase8 = read('src/services/orgApi.js');
assert('orgApi exports restoreOrgNode',
  /export async function restoreOrgNode/.test(orgApiSrcPhase8));

const hookSrcPhase8 = read('src/hooks/useOrgNodes.js');
assert('useOrgNodes exposes restoreNode',
  /restoreNode/.test(hookSrcPhase8));
assert('useOrgNodes exposes includeArchived toggle',
  /includeArchived,\s*setIncludeArchived/.test(hookSrcPhase8));

const orgViewSrcPhase8 = read('src/components/views/OrgView.jsx');
assert('OrgView toggles Show archived',
  /Show archived/.test(orgViewSrcPhase8));
assert('OrgView uses handleArchiveOrRestore so archived nodes are restorable',
  /handleArchiveOrRestore/.test(orgViewSrcPhase8));

// ── Section 16: Phase 10b — auto-seed lead as dept admin ─────────────────
console.log('\n── Phase 10b: lead-as-admin auto-seed ──');
const leadSeedSrc = read('src/lib/org-lead-admin-seed.js');
assert('lead-admin-seed exports ensureLeadIsDeptAdmin',
  /export async function ensureLeadIsDeptAdmin/.test(leadSeedSrc));
assert('lead-admin-seed UPSERTs team_member_overrides with access=admin',
  /INSERT INTO team_member_overrides[\s\S]+ON CONFLICT \(email\) DO UPDATE/.test(leadSeedSrc)
  && /access\s*=\s*'admin'/.test(leadSeedSrc));
assert('lead-admin-seed never writes the legacy team column',
  !/UPDATE team_member_overrides[\s\S]+\bteam\s*=/.test(leadSeedSrc));
assert('lead-admin-seed grants delegated admin via org_node_admins',
  /INSERT INTO org_node_admins[\s\S]+ON CONFLICT \(node_id, email\) DO NOTHING/.test(leadSeedSrc));
assert('lead-admin-seed writes node.lead_seeded audit row',
  /'node\.lead_seeded'/.test(leadSeedSrc));
assert('lead-admin-seed flags is_new based on baseline membership',
  /TEAM_MEMBERS/.test(leadSeedSrc) && /isInBaseline/.test(leadSeedSrc));

const postRouteSrcPhase10b = read('app/api/v1/org/nodes/route.js');
assert('POST /org/nodes imports ensureLeadIsDeptAdmin',
  /import \{ ensureLeadIsDeptAdmin \}/.test(postRouteSrcPhase10b));
assert('POST /org/nodes invokes auto-seed for kind=department + leadEmail',
  /if \(kind === 'department' && leadEmail\)/.test(postRouteSrcPhase10b)
  && /ensureLeadIsDeptAdmin\(\{/.test(postRouteSrcPhase10b));
assert('POST /org/nodes never auto-seeds for teams',
  !/if \(kind === 'team' && leadEmail\)/.test(postRouteSrcPhase10b));
assert('POST /org/nodes returns leadSeed payload',
  /leadSeed,/.test(postRouteSrcPhase10b));

const defaultSeedSrcPhase10b = read('src/lib/org-default-seed.js');
assert('org-default-seed bumps SEED_VERSION to 2',
  /const SEED_VERSION = 2/.test(defaultSeedSrcPhase10b));
assert('org-default-seed imports ensureLeadIsDeptAdmin',
  /import \{ ensureLeadIsDeptAdmin \} from '\.\/org-lead-admin-seed'/.test(defaultSeedSrcPhase10b));
assert('org-default-seed v2 backfills every dept with lead_email',
  /if \(currentVersion < 2\)/.test(defaultSeedSrcPhase10b)
  && /kind = 'department'[\s\S]+lead_email IS NOT NULL/.test(defaultSeedSrcPhase10b));
assert('org-default-seed v2 reports lead_admins_seeded',
  /lead_admins_seeded/.test(defaultSeedSrcPhase10b));

const formDrawerSrcPhase10b = read('src/components/org/OrgNodeFormDrawer.jsx');
assert('OrgNodeFormDrawer accepts getCurrentDeptForEmail prop',
  /getCurrentDeptForEmail/.test(formDrawerSrcPhase10b));
assert('OrgNodeFormDrawer renders LeadMoveWarning',
  /function LeadMoveWarning/.test(formDrawerSrcPhase10b)
  && /<LeadMoveWarning/.test(formDrawerSrcPhase10b));
assert('OrgNodeFormDrawer hint mentions auto-seed of Admin',
  /auto-seeded as this department's Admin/.test(formDrawerSrcPhase10b));

const orgViewSrcPhase10b = read('src/components/views/OrgView.jsx');
assert('OrgView defines getCurrentDeptForEmail and walks to top-level',
  /const getCurrentDeptForEmail = useCallback/.test(orgViewSrcPhase10b)
  && /while \(topLevel\.parentId/.test(orgViewSrcPhase10b));
assert('OrgView passes getCurrentDeptForEmail into OrgNodeFormDrawer',
  /getCurrentDeptForEmail=\{getCurrentDeptForEmail\}/.test(orgViewSrcPhase10b));

// ── Section 17: Phase 10a — Login-as-dept-admin button ───────────────────
console.log('\n── Phase 10a: Login-as-dept-admin button ──');
const appSrcPhase10a = read('src/App.jsx');
assert('App.jsx passes realUser + onImpersonate to OrgView',
  /<OrgView user=\{effectiveUser\} realUser=\{user\} onImpersonate=\{handleImpersonate\}/.test(appSrcPhase10a));

const orgViewSrcPhase10a = read('src/components/views/OrgView.jsx');
assert('OrgView defines GLOBAL_SUPER_ADMIN_EMAIL constant',
  /const GLOBAL_SUPER_ADMIN_EMAIL = 'mohamed\.tantawy@deel\.com'/.test(orgViewSrcPhase10a));
assert('OrgView derives isGlobalSuperAdmin from realUser first',
  /realUser\?\.email \|\| user\?\.email/.test(orgViewSrcPhase10a));
assert('OrgView exports handleLoginAsDeptAdmin via callback',
  /const handleLoginAsDeptAdmin = useCallback/.test(orgViewSrcPhase10a));
assert('OrgView passes isGlobalSuperAdmin + onLoginAsDeptAdmin to OrgChartCanvas',
  /isGlobalSuperAdmin=\{isGlobalSuperAdmin\}[\s\S]*onLoginAsDeptAdmin=\{handleLoginAsDeptAdmin\}/.test(orgViewSrcPhase10a));
assert('OrgView passes isGlobalSuperAdmin + onLoginAsDeptAdmin to OrgTreeView',
  (orgViewSrcPhase10a.match(/isGlobalSuperAdmin=\{isGlobalSuperAdmin\}/g) || []).length >= 2);

const treeSrcPhase10a = read('src/components/org/OrgTreeView.jsx');
assert('OrgTreeView renders Login-as-admin button under correct guards',
  /isGlobalSuperAdmin[\s\S]+node\.kind === 'department'[\s\S]+!node\.parentId[\s\S]+node\.leadEmail/.test(treeSrcPhase10a));
assert('OrgTreeView Login button invokes onLoginAsDeptAdmin with leadEmail',
  /onLoginAsDeptAdmin\?\.\(node\.leadEmail\)/.test(treeSrcPhase10a));

const chartSrcPhase10a = read('src/components/org/OrgChartCanvas.jsx');
assert('OrgChartCanvas threads isGlobalSuperAdmin into NodeCard',
  /isGlobalSuperAdmin=\{isGlobalSuperAdmin\}/.test(chartSrcPhase10a));
assert('OrgChartCanvas NodeCard guards Login button on root-dept + leadEmail',
  /isGlobalSuperAdmin[\s\S]+node\.kind === 'department'[\s\S]+!node\.parentId[\s\S]+node\.leadEmail/.test(chartSrcPhase10a));
assert('OrgChartCanvas Login button invokes onLoginAsDeptAdmin',
  /onLoginAsDeptAdmin\?\.\(node\.leadEmail\)/.test(chartSrcPhase10a));

// ── Section 18: Phase 11a — Multi-tenant foundation ──────────────────────
console.log('\n── Phase 11a: multi-tenant foundation ──');
const migrateSrcPhase11a = read('src/lib/migrate.js');

// Schema ALTERs for every surface table
for (const tbl of [
  'announcements', 'hr_hub_request', 'leader_alert',
  'urgent_assist_request', 'urgent_assist_schedule',
  'time_off_events', 'handovers', 'tasks', 'workspace_members',
]) {
  assert(`migrate.js adds org_node_id to ${tbl}`,
    new RegExp(`ALTER TABLE ${tbl}\\s+ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes\\(id\\) ON DELETE SET NULL`).test(migrateSrcPhase11a));
  assert(`migrate.js indexes ${tbl}.org_node_id`,
    new RegExp(`CREATE INDEX IF NOT EXISTS idx_${tbl}_org_node`).test(migrateSrcPhase11a));
}
assert('migrate.js imports backfillHrExperienceTenancyIfNeeded',
  /import \{ backfillHrExperienceTenancyIfNeeded \} from '\.\/dept-backfill'/.test(migrateSrcPhase11a));
assert('migrate.js calls backfillHrExperienceTenancyIfNeeded after seedOrgDefaultIfNeeded',
  /seedOrgDefaultIfNeeded\(\);[\s\S]*?backfillHrExperienceTenancyIfNeeded\(\)/.test(migrateSrcPhase11a));

const deptScopeSrc = read('src/lib/dept-scope.js');
assert('dept-scope exports GLOBAL_SUPER_ADMIN_EMAIL = mohamed.tantawy@deel.com',
  /export const GLOBAL_SUPER_ADMIN_EMAIL = 'mohamed\.tantawy@deel\.com'/.test(deptScopeSrc));
assert('dept-scope exports SUPER_ADMIN_DEPT_COOKIE',
  /export const SUPER_ADMIN_DEPT_COOKIE = 'ops_hub_super_admin_dept'/.test(deptScopeSrc));
assert('dept-scope getCurrentDeptId honors super-admin cookie',
  /isGlobalSuperAdmin\(user\)[\s\S]*?readSuperAdminCookie/.test(deptScopeSrc));
assert('dept-scope getCurrentDeptId validates cookie against active dept',
  /parent_id IS NULL AND is_archived = false/.test(deptScopeSrc));
assert('dept-scope walks parent_id chain to top-level dept',
  /WITH RECURSIVE chain AS[\s\S]+parent_id IS NULL/.test(deptScopeSrc));
assert('dept-scope caches resolution with TTL',
  /TTL_MS = 30_000/.test(deptScopeSrc));
assert('dept-scope exposes clearDeptScopeCache for invalidation',
  /export function clearDeptScopeCache/.test(deptScopeSrc));

const backfillSrc = read('src/lib/dept-backfill.js');
assert('dept-backfill exports backfillHrExperienceTenancyIfNeeded',
  /export async function backfillHrExperienceTenancyIfNeeded/.test(backfillSrc));
assert('dept-backfill targets exactly the 9 isolated surfaces',
  /'announcements'[\s\S]+'hr_hub_request'[\s\S]+'leader_alert'[\s\S]+'urgent_assist_request'[\s\S]+'urgent_assist_schedule'[\s\S]+'time_off_events'[\s\S]+'handovers'[\s\S]+'tasks'[\s\S]+'workspace_members'/.test(backfillSrc));
assert('dept-backfill resolves HRX UUID via slug (not name)',
  /HR_EXPERIENCE_SLUG = 'hr-experience'/.test(backfillSrc)
  && /WHERE slug = \$1/.test(backfillSrc));
assert('dept-backfill UPDATE only targets NULL org_node_id (idempotent)',
  /SET org_node_id = \$1 WHERE org_node_id IS NULL/.test(backfillSrc));
assert('dept-backfill version-marked in app_settings',
  /BACKFILL_KEY = 'dept_backfill_version'/.test(backfillSrc)
  && /app_settings/.test(backfillSrc));
assert('dept-backfill writes dept.backfill_hrx audit row',
  /'dept\.backfill_hrx'/.test(backfillSrc));

const scopeRouteSrc = read('app/api/v1/dept-scope/current/route.js');
assert('dept-scope GET endpoint returns deptId + isGlobalSuperAdmin',
  /isGlobalSuperAdmin: superAdmin/.test(scopeRouteSrc));
assert('dept-scope POST endpoint is super-admin-only (Forbidden otherwise)',
  /if \(!isGlobalSuperAdmin\(user\)\)[\s\S]*Forbidden/.test(scopeRouteSrc));
assert('dept-scope POST validates dept is top-level + active',
  /parent_id IS NULL AND is_archived = false/.test(scopeRouteSrc));
assert('dept-scope POST sets sameSite=lax + 30-day cookie',
  /sameSite: 'lax'/.test(scopeRouteSrc)
  && /maxAge: 60 \* 60 \* 24 \* 30/.test(scopeRouteSrc));

const hookSrc = read('src/hooks/useCurrentDept.js');
assert('useCurrentDept exposes setDept that reloads on success',
  /export function useCurrentDept/.test(hookSrc)
  && /window\.location\.reload/.test(hookSrc));
assert('useCurrentDept tolerates 401 silently during initial paint',
  /res\.status === 401/.test(hookSrc));

const topNavSrc = read('src/components/nav/DeelTopNav.jsx');
assert('DeelTopNav imports useCurrentDept',
  /import \{ useCurrentDept \} from '\.\.\/\.\.\/hooks\/useCurrentDept'/.test(topNavSrc));
assert('DeelTopNav gates dept picker on isGlobalSuperAdmin',
  /deptState\.isGlobalSuperAdmin/.test(topNavSrc));
assert('DeelTopNav dept picker offers Reset to home',
  /Reset to home dept/.test(topNavSrc));
assert('DeelTopNav dept picker click invokes setDept',
  /deptState\.setDept\(d\.id\)/.test(topNavSrc)
  && /deptState\.setDept\(null\)/.test(topNavSrc));

// ── Section 19: Phase 11b — Announcements isolation ──────────────────────
console.log('\n── Phase 11b: announcements isolation ──');
const annFlowSrc = read('src/lib/announcementFlow.js');
assert('announcementFlow accepts options.orgNodeId',
  /const orgNodeId = options\.orgNodeId \|\| null/.test(annFlowSrc));
assert('announcementFlow INSERT includes org_node_id column',
  /INSERT INTO announcements[\s\S]+org_node_id\)/.test(annFlowSrc));

const annListRouteSrc = read('app/api/v1/announcements/route.js');
assert('announcements GET imports getCurrentDeptId',
  /import \{ getCurrentDeptId \}/.test(annListRouteSrc));
assert('announcements GET filters by currentDeptId',
  /currentDeptId[\s\S]+AND org_node_id = \$/.test(annListRouteSrc));
assert('announcements GET fails closed when no dept (1=0 deny)',
  /AND 1=0/.test(annListRouteSrc));
assert('announcements POST stamps orgNodeId from actor currentDeptId',
  /const orgNodeId = await getCurrentDeptId\(user, req\)[\s\S]+orgNodeId,/.test(annListRouteSrc));

const annIdRouteSrc = read('app/api/v1/announcements/[id]/route.js');
assert('announcements/id GET filters by currentDeptId',
  /WHERE id = \$1 AND org_node_id = \$2/.test(annIdRouteSrc));
assert('announcements/id PATCH refuses cross-dept edits',
  /AND org_node_id = \$\$\{idx \+ 1\}/.test(annIdRouteSrc));
assert('announcements/id DELETE refuses cross-dept deletes',
  /DELETE FROM announcements WHERE id = \$1 AND org_node_id = \$2/.test(annIdRouteSrc));

const approveSrc = read('app/api/v1/announcement-requests/[id]/approve/route.js');
assert('announcement-requests approve resolves requester dept',
  /getTopLevelDeptForMember\(r\.requested_by_email\)/.test(approveSrc));
assert('announcement-requests approve passes orgNodeId to publishFromRequest',
  /publishFromRequest\([\s\S]+orgNodeId: requesterDept\?\.deptId/.test(approveSrc));

const publishSrc = read('app/api/v1/announcement-requests/[id]/publish/route.js');
assert('announcement-requests publish resolves requester dept',
  /getTopLevelDeptForMember\(r\.requested_by_email\)/.test(publishSrc));
assert('announcement-requests publish passes orgNodeId to publishFromRequest',
  /publishFromRequest\([\s\S]+orgNodeId: requesterDept\?\.deptId/.test(publishSrc));

// ── Section 20: Phase 11c — HR Hub isolation ─────────────────────────────
console.log('\n── Phase 11c: HR Hub isolation ──');
const hrHubListSrc = read('app/api/v1/hr-hub/requests/route.js');
assert('hr-hub/requests imports getCurrentDeptId',
  /import \{ getCurrentDeptId \}/.test(hrHubListSrc));
assert('hr-hub/requests GET filters by currentDeptId (org_node_id) first',
  /currentDeptId[\s\S]+where\.push\(`org_node_id = \$/.test(hrHubListSrc));
assert('hr-hub/requests GET fails closed when no dept',
  /where\.push\(`FALSE`\)/.test(hrHubListSrc));
assert('hr-hub/requests POST stamps submitterDeptId on INSERT',
  /submitterDeptId = await getCurrentDeptId\(user, req\)/.test(hrHubListSrc)
  && /org_node_id\)/.test(hrHubListSrc)
  && /submitterDeptId,/.test(hrHubListSrc));

const hrHubIdSrc = read('app/api/v1/hr-hub/requests/[id]/route.js');
assert('hr-hub/requests/[id] imports getCurrentDeptId',
  /import \{ getCurrentDeptId \}/.test(hrHubIdSrc));
assert('hr-hub/requests/[id] GET filters by currentDeptId',
  /WHERE id = \$1 AND org_node_id = \$2/.test(hrHubIdSrc));
assert('hr-hub/requests/[id] PATCH refuses cross-dept SELECT + UPDATE',
  /SELECT \* FROM hr_hub_request WHERE id = \$1 AND org_node_id = \$2/.test(hrHubIdSrc)
  && /AND org_node_id = \$\$\{p \+ 1\}/.test(hrHubIdSrc));

// ── Section 21: Phase 11d — Leaders Hub isolation ────────────────────────
console.log('\n── Phase 11d: Leaders Hub isolation ──');
const leaderListSrc = read('app/api/v1/leader-alerts/alerts/route.js');
assert('leader-alerts list imports getCurrentDeptId',
  /import \{ getCurrentDeptId \}/.test(leaderListSrc));
assert('leader-alerts list filters by currentDeptId / FALSE fail-closed',
  /where\.push\(`org_node_id = \$/.test(leaderListSrc)
  && /where\.push\(`FALSE`\)/.test(leaderListSrc));
assert('leader-alerts list stamps creatorDeptId on INSERT',
  /creatorDeptId,/.test(leaderListSrc)
  && /org_node_id\)\s*VALUES \('new'/.test(leaderListSrc));

const leaderIdSrc = read('app/api/v1/leader-alerts/alerts/[id]/route.js');
assert('leader-alerts/[id] imports getCurrentDeptId',
  /import \{ getCurrentDeptId \}/.test(leaderIdSrc));
assert('leader-alerts/[id] GET filters by org_node_id',
  /WHERE a\.id = \$1 AND a\.org_node_id = \$3/.test(leaderIdSrc));
assert('leader-alerts/[id] PATCH refuses cross-dept',
  /SELECT \* FROM leader_alert WHERE id = \$1 AND org_node_id = \$2/.test(leaderIdSrc));
assert('leader-alerts/[id] DELETE refuses cross-dept',
  /DELETE FROM leader_alert WHERE id = \$1 AND org_node_id = \$2/.test(leaderIdSrc));

const unackedSrc = read('app/api/v1/leader-alerts/unacked-count/route.js');
assert('leader-alerts unacked-count is dept-scoped',
  /a\.org_node_id = \$3/.test(unackedSrc));

// ── Section 22: Phase 11e — OOO + Handovers isolation ────────────────────
console.log('\n── Phase 11e: OOO + Handovers isolation ──');
const tofListSrc = read('app/api/v1/time-off-events/route.js');
assert('time-off-events list filters by currentDeptId',
  /e\.org_node_id = \$/.test(tofListSrc));
assert('time-off-events POST stamps subject (work_email) dept',
  /getTopLevelDeptForMember\(workEmail\)/.test(tofListSrc)
  && /subjectDeptId/.test(tofListSrc)
  && /org_node_id\)/.test(tofListSrc));

const tofIdSrc = read('app/api/v1/time-off-events/[id]/route.js');
assert('time-off-events/[id] DELETE refuses cross-dept',
  /SELECT work_email FROM time_off_events WHERE id = \$1 AND org_node_id = \$2/.test(tofIdSrc)
  && /DELETE FROM time_off_events WHERE id = \$1 AND org_node_id = \$2/.test(tofIdSrc));

const hoListSrc = read('app/api/v1/handovers/route.js');
assert('handovers POST stamps requester dept on INSERT',
  /requesterDeptId/.test(hoListSrc)
  && /org_node_id\)/.test(hoListSrc));
assert('handovers GET filters by currentDeptId / FALSE',
  /h\.org_node_id = \$/.test(hoListSrc)
  && /where\.push\(`FALSE`\)/.test(hoListSrc));

const hoIdSrc = read('app/api/v1/handovers/[id]/route.js');
assert('handovers/[id] GET 404s cross-dept',
  /handover\.org_node_id && handover\.org_node_id !== currentDeptId/.test(hoIdSrc));
assert('handovers/[id] PATCH 404s cross-dept',
  /handover\.org_node_id && handover\.org_node_id !== currentDeptId[\s\S]+?Not found/.test(hoIdSrc));
assert('handovers/[id] DELETE 404s cross-dept',
  (hoIdSrc.match(/handover\.org_node_id && handover\.org_node_id !== currentDeptId/g) || []).length >= 3);

// ── Section 23: Phase 11f — Urgent Assist isolation ──────────────────────
console.log('\n── Phase 11f: Urgent Assist isolation ──');
const uaListSrc = read('app/api/v1/urgent-assist/route.js');
assert('urgent-assist GET filters by currentDeptId / FALSE',
  /where\.push\(`org_node_id = \$/.test(uaListSrc)
  && /where\.push\(`FALSE`\)/.test(uaListSrc));
assert('urgent-assist POST stamps submitterDeptId',
  /submitterDeptId/.test(uaListSrc));

const uaIdSrc = read('app/api/v1/urgent-assist/[id]/route.js');
assert('urgent-assist/[id] loadRow gates by org_node_id',
  /WHERE id = \$1 AND org_node_id = \$2/.test(uaIdSrc));
assert('urgent-assist/[id] PATCH dept-scoped UPDATE',
  /UPDATE urgent_assist_request SET[\s\S]+AND org_node_id = \$\$\{p \+ 1\}/.test(uaIdSrc));
assert('urgent-assist/[id] DELETE dept-scoped',
  /DELETE FROM urgent_assist_request WHERE id = \$1 AND org_node_id = \$2/.test(uaIdSrc));

const uaSchedListSrc = read('app/api/v1/urgent-assist-schedule/route.js');
assert('urgent-assist-schedule GET dept-isolated',
  /where\.push\(`org_node_id = \$/.test(uaSchedListSrc));
assert('urgent-assist-schedule POST stamps actor dept',
  /currentDeptId,?\s*\]/.test(uaSchedListSrc)
  && /org_node_id\)/.test(uaSchedListSrc));

const uaSchedIdSrc = read('app/api/v1/urgent-assist-schedule/[id]/route.js');
assert('urgent-assist-schedule/[id] DELETE dept-scoped',
  /DELETE FROM urgent_assist_schedule WHERE id = \$1 AND org_node_id = \$2/.test(uaSchedIdSrc));

// ── Section 24: Phase 11g — Workspaces / My Queue isolation ──────────────
console.log('\n── Phase 11g: Workspaces / My Queue isolation ──');
const wsMembersSrc = read('src/lib/workspace-members.js');
assert('workspace-members addMember resolves subject dept via dept-scope',
  /getTopLevelDeptForMember\(e\)/.test(wsMembersSrc));
assert('workspace-members addMember stamps org_node_id on INSERT',
  /INSERT INTO workspace_members \(workspace_id, email, role, added_by, org_node_id\)/.test(wsMembersSrc));
// Note: /api/v1/queue + /api/v1/workspaces/[workspaceId]/queue are Zendesk-
// sourced, so dept-isolation flows through Phase 11h tasks isolation +
// workspace_members.org_node_id (this PR). No DB-level queue filter to
// audit here.

// ── Section 25: Phase 11h — Tasks isolation ──────────────────────────────
console.log('\n── Phase 11h: Tasks isolation ──');
const tasksListSrc = read('app/api/v1/tasks/route.js');
assert('tasks list imports getCurrentDeptId',
  /import \{ getCurrentDeptId \}/.test(tasksListSrc));
assert('tasks list filters by t.org_node_id with fail-closed',
  /t\.org_node_id = \$/.test(tasksListSrc)
  && /whereSql \+= ` AND 1=0`/.test(tasksListSrc));
assert('tasks POST stamps orgNodeId on INSERT',
  /INSERT INTO tasks[\s\S]+org_node_id\)/.test(tasksListSrc)
  && /const orgNodeId = await getCurrentDeptId\(postUser, req\)/.test(tasksListSrc));

const tasksIdSrc = read('app/api/v1/tasks/[id]/route.js');
assert('tasks/[id] GET filters by t.org_node_id',
  /WHERE t\.id = \$1 AND t\.org_node_id = \$2/.test(tasksIdSrc));
assert('tasks/[id] DELETE filters by org_node_id',
  /WHERE id = \$1 AND org_node_id = \$2/.test(tasksIdSrc));

const tasksSnoozeSrc = read('app/api/v1/tasks/[id]/snooze/route.js');
assert('tasks/[id]/snooze stamps shadow row dept on INSERT',
  /INSERT INTO tasks[\s\S]+org_node_id\)/.test(tasksSnoozeSrc));

const reassignSrc = read('app/api/v1/queue/reassign/route.js');
assert('queue/reassign shadow upsert stamps org_node_id',
  /INSERT INTO tasks[\s\S]+org_node_id\)/.test(reassignSrc));
assert('queue/reassign ON CONFLICT does NOT touch org_node_id (immutable)',
  !/ON CONFLICT[\s\S]+org_node_id = EXCLUDED\.org_node_id/.test(reassignSrc));

const actionsSrc = read('app/api/v1/queue/[ticketId]/actions/route.js');
assert('queue/actions shadow upsert stamps org_node_id',
  /'org_node_id'/.test(actionsSrc)
  && /orgNodeId/.test(actionsSrc));
assert('queue/actions resolves orgNodeId once per POST',
  /const orgNodeId = await getCurrentDeptId\(user, req\)/.test(actionsSrc));

// ── Section 26: Phase 11i — Integration sweep + HRX-no-impact contract ───
console.log('\n── Phase 11i: integration sweep + HRX-no-impact contract ──');

// Spot-checked gaps fixed in this PR:
const readSrc = read('app/api/v1/announcements/[id]/read/route.js');
assert('announcements/[id]/read dept-scopes existence check (no cross-dept ack)',
  /AND org_node_id = \$2/.test(readSrc)
  && /getCurrentDeptId/.test(readSrc));

const importSrc = read('app/api/v1/time-off-events/import/route.js');
assert('time-off-events/import stamps subject dept per row',
  /getTopLevelDeptForMember/.test(importSrc)
  && /org_node_id\)/.test(importSrc));

// HRX-no-impact contract: every isolated surface read filters by org_node_id.
// Spot-check that the canonical pattern (WHERE ... org_node_id = $deptId)
// appears in each surface's primary route.
const HRX_NO_IMPACT_ROUTES = [
  ['app/api/v1/announcements/route.js',                'AND org_node_id = \\$'],
  ['app/api/v1/hr-hub/requests/route.js',              '`org_node_id = \\$'],
  ['app/api/v1/leader-alerts/alerts/route.js',         '`org_node_id = \\$'],
  ['app/api/v1/urgent-assist/route.js',                '`org_node_id = \\$'],
  ['app/api/v1/time-off-events/route.js',              'e\\.org_node_id = \\$'],
  ['app/api/v1/handovers/route.js',                    'h\\.org_node_id = \\$'],
  ['app/api/v1/tasks/route.js',                        't\\.org_node_id = \\$'],
];
for (const [path, pattern] of HRX_NO_IMPACT_ROUTES) {
  const src = read(path);
  assert(`HRX-no-impact: ${path} reads filter by org_node_id`,
    new RegExp(pattern).test(src));
}

// And that the legacy `team` column is NEVER written from the new lead-seed
// helper — the queue-scoping boundary for ~84 HRX agents must stay untouched.
const leadSeedFinalSrc = read('src/lib/org-lead-admin-seed.js');
assert('HRX-no-impact: org-lead-admin-seed never writes legacy team column',
  !/UPDATE team_member_overrides[\s\S]+\bteam\s*=/.test(leadSeedFinalSrc));

// dept-backfill targets every surface — single sweep guarantees HRX
// stamping across the whole product on first prod boot after this deploys.
const backfillFinalSrc = read('src/lib/dept-backfill.js');
const REQUIRED_SURFACES = [
  'announcements', 'hr_hub_request', 'leader_alert',
  'urgent_assist_request', 'urgent_assist_schedule',
  'time_off_events', 'handovers', 'tasks', 'workspace_members',
];
for (const tbl of REQUIRED_SURFACES) {
  assert(`HRX-no-impact: backfill stamps ${tbl}`,
    new RegExp(`'${tbl}'`).test(backfillFinalSrc));
}

// ── Section 27: Phase 11j — urgent_assist_schedule composite unique fix ──
console.log('\n── Phase 11j: urgent_assist_schedule unique-constraint fix ──');
const migrateSrcPhase11j = read('src/lib/migrate.js');
assert('migrate.js drops the legacy single-column UNIQUE on schedule_date',
  /DROP CONSTRAINT IF EXISTS urgent_assist_schedule_schedule_date_key/.test(migrateSrcPhase11j));
assert('migrate.js adds composite UNIQUE (schedule_date, org_node_id) partial index',
  /uniq_urgent_assist_schedule_date_dept[\s\S]+ON urgent_assist_schedule\(schedule_date, org_node_id\)[\s\S]+WHERE org_node_id IS NOT NULL/.test(migrateSrcPhase11j));

const schedRouteSrcPhase11j = read('app/api/v1/urgent-assist-schedule/route.js');
assert('urgent-assist-schedule POST fails closed without dept context',
  /Cannot save schedule without a department context/.test(schedRouteSrcPhase11j));
assert('urgent-assist-schedule POST uses composite ON CONFLICT with partial predicate',
  /ON CONFLICT \(schedule_date, org_node_id\) WHERE org_node_id IS NOT NULL DO UPDATE/.test(schedRouteSrcPhase11j));
assert('urgent-assist-schedule POST no longer references the legacy single-column ON CONFLICT',
  !/ON CONFLICT \(schedule_date\) DO UPDATE/.test(schedRouteSrcPhase11j));

// ── Section 28: Phase 12a — Smart chart redesign ─────────────────────────
console.log('\n── Phase 12a: smart chart redesign ──');

const layoutSrcPhase12a = read('src/utils/orgChartLayout.js');
assert('orgChartLayout exports new card dimensions (CARD_W >= 240)',
  /export const CARD_W = (2[4-9]\d|[3-9]\d\d)/.test(layoutSrcPhase12a));
assert('orgChartLayout accepts expansion in args',
  /layoutOrgChart\(\{[\s\S]*expansion[\s\S]*\}\)/.test(layoutSrcPhase12a));
assert('orgChartLayout gates sub-tree descent on expansion.expandedTeamId',
  /expansion\.expandedTeamId === node\.id/.test(layoutSrcPhase12a));
assert('orgChartLayout gates members on expansion.showMembers',
  /expansion\.showMembers\.has\(node\.id\)/.test(layoutSrcPhase12a));
assert('orgChartLayout always descends from department to teams',
  /if \(node\.kind === 'department'\)[\s\S]+?descend = true/.test(layoutSrcPhase12a));

const canvasSrcPhase12a = read('src/components/org/OrgChartCanvas.jsx');
assert('OrgChartCanvas threads expansion to layoutOrgChart',
  /layoutOrgChart\(\{ tree, rootNodes, members, expansion \}\)/.test(canvasSrcPhase12a));
assert('OrgChartCanvas builds membersByEmail for lead lookup',
  /const membersByEmail = useMemo/.test(canvasSrcPhase12a));
assert('OrgChartCanvas builds per-node subtreeStats helper',
  /const subtreeStats = useMemo/.test(canvasSrcPhase12a)
  && /descendantMembers/.test(canvasSrcPhase12a)
  && /directTeams/.test(canvasSrcPhase12a));
assert('OrgChartCanvas accepts expansion + callbacks props',
  /onToggleTeamExpansion/.test(canvasSrcPhase12a)
  && /onToggleShowMembers/.test(canvasSrcPhase12a));
assert('NodeCard accepts lead + stats + toggle props',
  /function NodeCard\([\s\S]+?lead,[\s\S]+?stats,[\s\S]+?canToggleExpand,[\s\S]+?isExpanded,[\s\S]+?isShowingMembers,/.test(canvasSrcPhase12a));
assert('NodeCard renders an embedded lead row with Avatar',
  /Avatar size=\{22\} name=\{lead\.name\}/.test(canvasSrcPhase12a));
assert('NodeCard exposes the Expand button (gated on canToggleExpand)',
  /canToggleExpand && \(/.test(canvasSrcPhase12a)
  && /onClick=\{onToggleExpand\}/.test(canvasSrcPhase12a));
assert('NodeCard exposes the Show members button (gated on memberCount > 0)',
  /memberCount > 0 && \(/.test(canvasSrcPhase12a)
  && /onClick=\{onToggleShowMembers\}/.test(canvasSrcPhase12a));
assert('NodeCard preserves Phase 10a Login-as-dept-admin pill',
  /onLoginAsDeptAdmin\?\.\(node\.leadEmail\)/.test(canvasSrcPhase12a));

const viewSrcPhase12a = read('src/components/views/OrgView.jsx');
assert('OrgView holds chartExpansion state with the three slots',
  /const \[chartExpansion, setChartExpansion\] = useState/.test(viewSrcPhase12a)
  && /expandedTeamId: null/.test(viewSrcPhase12a)
  && /expandedSubTeamId: null/.test(viewSrcPhase12a)
  && /showMembers: new Set\(\)/.test(viewSrcPhase12a));
assert('OrgView toggleTeamExpansion auto-collapses prior sub-team on team change',
  /expandedSubTeamId: null/.test(viewSrcPhase12a)
  && /expandedTeamId === nodeId \? null : nodeId/.test(viewSrcPhase12a));
assert('OrgView wires expansion + callbacks into OrgChartCanvas',
  /expansion=\{chartExpansion\}[\s\S]+?onToggleTeamExpansion=\{toggleTeamExpansion\}[\s\S]+?onToggleShowMembers=\{toggleShowMembers\}/.test(viewSrcPhase12a));

// ── Section 29: Phase 13a — Per-department integration config ────────────
console.log('\n── Phase 13a: per-department integration config ──');

const deptIntegrationsSrc = read('src/lib/dept-integrations.js');
assert('dept-integrations exports DEPT_INTEGRATIONS map',
  /export const DEPT_INTEGRATIONS/.test(deptIntegrationsSrc));
assert('dept-integrations has HR Experience entry with HRX env vars (no change)',
  /'hr-experience'[\s\S]+ZENDESK_API_TOKEN[\s\S]+JIRA_API_TOKEN[\s\S]+DEEL_ADMIN_TOKEN/.test(deptIntegrationsSrc));
assert('dept-integrations has Global Immigration entry with GIX env vars',
  /'global-immigration'[\s\S]+Zendesk_API_Payroll_GIX[\s\S]+JIRA_GIX[\s\S]+DEEL_ADMIN_GIX/.test(deptIntegrationsSrc));
assert('Global Immigration hides 5 Deel sources (onboarding/offboarding/amendments/redlines/incentivePlans)',
  /'global-immigration'[\s\S]+onboarding: false,[\s\S]+offboarding: false,[\s\S]+amendments: false,[\s\S]+redlines: false,[\s\S]+incentivePlans: false/.test(deptIntegrationsSrc));
assert('Global Immigration Zendesk group = Immigration Experience',
  /'global-immigration'[\s\S]+'Immigration Experience'/.test(deptIntegrationsSrc));
assert('Global Immigration Jira filter includes Global Mobility',
  /'global-immigration'[\s\S]+ownerFieldValues:[\s\S]+'Global Mobility'/.test(deptIntegrationsSrc));
assert('Global Immigration Workbench team filter = Mobility Operations + GSC - Mobility',
  /'global-immigration'[\s\S]+teamFilter:[\s\S]+'Mobility Operations'[\s\S]+'GSC - Mobility'/.test(deptIntegrationsSrc));
assert('dept-integrations exports the per-source helper isDeelSourceVisible',
  /export function isDeelSourceVisible/.test(deptIntegrationsSrc));
assert('dept-integrations exports visibleDeelSourcesFor (used by dept-scope/current)',
  /export function visibleDeelSourcesFor/.test(deptIntegrationsSrc));
assert('dept-integrations exposes resolveWorkbenchConfig / resolveJiraConfig / resolveZendeskConfig',
  /export function resolveWorkbenchConfig/.test(deptIntegrationsSrc)
  && /export function resolveJiraConfig/.test(deptIntegrationsSrc)
  && /export function resolveZendeskConfig/.test(deptIntegrationsSrc));

const deptScopeSrcPhase13a = read('src/lib/dept-scope.js');
assert('dept-scope exposes getCurrentDeptSlugAndId',
  /export async function getCurrentDeptSlugAndId/.test(deptScopeSrcPhase13a));
assert('dept-scope recursive CTE selects slug column for top-level resolve',
  /SELECT id, name, slug FROM chain WHERE parent_id IS NULL/.test(deptScopeSrcPhase13a));

const scopeCurrentSrcPhase13a = read('app/api/v1/dept-scope/current/route.js');
assert('/api/v1/dept-scope/current returns visibleSources',
  /visibleSources,/.test(scopeCurrentSrcPhase13a)
  && /visibleDeelSourcesFor\(dept\?\.slug \|\| null\)/.test(scopeCurrentSrcPhase13a));

const hookSrcPhase13a = read('src/hooks/useCurrentDept.js');
assert('useCurrentDept exposes visibleSources with fail-closed defaults',
  /visibleSources: EMPTY_VISIBLE_SOURCES/.test(hookSrcPhase13a)
  && /visibleSources: \(data\.visibleSources/.test(hookSrcPhase13a));

// All 7 Deel-source routes early-exit when disabled.
const DEEL_ROUTES = [
  ['app/api/v1/integrations/deel/onboarding/route.js',       "'onboarding'"],
  ['app/api/v1/integrations/deel/onboarding-paused/route.js', "'onboarding'"],
  ['app/api/v1/integrations/deel/offboarding/route.js',      "'offboarding'"],
  ['app/api/v1/integrations/deel/amendments/route.js',       "'amendments'"],
  ['app/api/v1/integrations/deel/redlines/route.js',         "'redlines'"],
  ['app/api/v1/integrations/deel/incentive-plans/route.js',  "'incentivePlans'"],
  ['app/api/v1/integrations/deel/workbench/route.js',        "'workbench'"],
];
for (const [path, sourceKey] of DEEL_ROUTES) {
  const src = read(path);
  assert(`${path.split('/').slice(-2, -1)[0]} route gates by isDeelSourceVisible(${sourceKey})`,
    src.includes('isDeelSourceVisible')
    && src.includes(sourceKey)
    && /disabled: true, reason: 'source-disabled-for-dept'/.test(src));
}

// HRX-no-impact: every HRX-side env var in the integration profile must
// match the ORIGINAL values the pre-Phase-13a routes read. Regression
// guard so a future tweak doesn't accidentally retarget HRX.
assert('HRX-no-impact: HRX zendesk token env unchanged',
  /'hr-experience'[\s\S]+tokenEnvVar: 'ZENDESK_API_TOKEN'/.test(deptIntegrationsSrc));
assert('HRX-no-impact: HRX zendesk group env unchanged',
  /'hr-experience'[\s\S]+groupEnvVar: 'ZENDESK_HR_GROUP'/.test(deptIntegrationsSrc));
assert('HRX-no-impact: HRX jira project keys unchanged (COHD, OSHD)',
  /'hr-experience'[\s\S]+projectKeys: \['COHD', 'OSHD'\]/.test(deptIntegrationsSrc));
assert('HRX-no-impact: HRX all 6 Deel sources enabled',
  /'hr-experience'[\s\S]+onboarding: true,[\s\S]+offboarding: true,[\s\S]+amendments: true,[\s\S]+redlines: true,[\s\S]+incentivePlans: true,[\s\S]+workbench: true/.test(deptIntegrationsSrc));

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

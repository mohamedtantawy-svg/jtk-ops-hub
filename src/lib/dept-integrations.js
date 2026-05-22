// ── Per-department integration config (Phase 13a — 2026-05-20) ────────────
// Each top-level department gets its own integration profile: which
// Zendesk token + group, which Jira token + project + filter, which Deel
// admin token + Workbench team filter, and which Deel sources (onboarding /
// offboarding / amendments / redlines / incentive plans / workbench)
// render in its surfaces.
//
// HR Experience keeps the ORIGINAL env vars (and the original behavior).
// Every other department starts with empty/false defaults — explicit
// configuration is required before its admins see real data, so a
// newly-created department doesn't accidentally inherit HRX's queue.
//
// The config is keyed by `org_nodes.slug` (not UUID) so it survives a
// renamed UI label. Slugs are stable; only mohamed can change them.
//
// Token names are stored here as env-var NAMES (not the secrets
// themselves). Every read resolves `process.env[name]` at request time
// so a rotation in Nexus doesn't require a process restart.

// Canonical slugs MUST match what's actually persisted in `org_nodes.slug`
// in prod — the 2026-05-20 deploy revealed that GIX was stored as 'gix'
// (not 'global-immigration') and Benefits as 'benefits' (not
// 'benefits-operations') because mohamed chose those slugs when creating
// the depts via UI. Slugs are stable + this map is keyed by slug, so the
// constants here must reflect the live values, not aspirational ones.
const HR_EXPERIENCE_SLUG = 'hr-experience';
const GLOBAL_IMMIGRATION_SLUG = 'gix';
const PAYROLL_OPERATIONS_SLUG = 'payroll-operations';
const BENEFITS_OPERATIONS_SLUG = 'benefits';

// Default Deel-source flags for a brand-new department. All FALSE so a
// freshly-stood-up dept doesn't accidentally render HRX-style sections
// until its admin explicitly enables them.
const EMPTY_DEEL_SOURCES = Object.freeze({
  onboarding: false,
  offboarding: false,
  amendments: false,
  redlines: false,
  incentivePlans: false,
  workbench: false,
});

export const DEPT_INTEGRATIONS = {
  // ── HR Experience ───────────────────────────────────────────────────────
  // The existing canonical config. Reads the SAME env vars the original
  // pre-Phase-13a code used so HRX behavior is byte-identical. Do not
  // touch these values without coordinating an HRX-wide cutover.
  [HR_EXPERIENCE_SLUG]: {
    zendesk: {
      tokenEnvVar: 'ZENDESK_API_TOKEN',
      groupEnvVar: 'ZENDESK_HR_GROUP',
      defaultGroup: 'HR Experience',
    },
    jira: {
      tokenEnvVar: 'JIRA_API_TOKEN',
      // baseUrl + email come from the existing JIRA_BASE_URL / JIRA_USER_EMAIL
      // (shared instance across all depts today).
      projectKeys: ['COHD', 'OSHD'],
      ownerFieldValues: null, // null = use existing HRX-responsible logic
    },
    workbench: {
      tokenEnvVar: 'DEEL_ADMIN_TOKEN',
      teamFilter: null, // null = no team filter (HRX's default behavior)
    },
    deelSources: {
      onboarding: true,
      offboarding: true,
      amendments: true,
      redlines: true,
      incentivePlans: true,
      workbench: true,
    },
  },

  // ── Global Immigration ──────────────────────────────────────────────────
  // mohamed's 2026-05-20 setup. Uses the per-workspace gix tokens already
  // wired for the Workspaces feature, plus the new JIRA_GIX + DEEL_ADMIN_GIX
  // env vars added in Nexus for this department. Deel-source sections that
  // don't belong to immigration (onboarding/offboarding/amendments/redlines/
  // incentive plans) are hidden entirely — only the Workbench surface
  // renders, with its own team filter.
  [GLOBAL_IMMIGRATION_SLUG]: {
    zendesk: {
      // Reuses the workspace-zendesk-api 'gix' config so we don't duplicate
      // the same token registration in two places.
      tokenEnvVar: 'Zendesk_API_Payroll_GIX',
      // 2026-05-22 (afternoon): Mohamed sent the stable Zendesk group_id
      // for the Immigration Experience group. Using the numeric ID via
      // Zendesk Search's `group_id:` operator is more resilient than
      // `group:"..."` (group names can be renamed in Zendesk; IDs don't
      // change). Fetcher prefers groupId when set; defaultGroup stays as
      // documentation + fallback if the ID is ever wiped.
      groupIdEnvVar: 'ZENDESK_GIX_GROUP_ID',
      defaultGroupId: '26903282539025',
      groupEnvVar: 'ZENDESK_GIX_GROUP',
      defaultGroup: 'Immigration Experience',
    },
    jira: {
      tokenEnvVar: 'JIRA_GIX',
      // 2026-05-22: spec from Mohamed — three clauses, each fetched as
      // active + resolved-in-24h, de-duped by issue key:
      //   1. COHD + OSHD with Team = "Global Mobility"
      //   2. COHD with Request Type = "Mobility Terminations"
      //      (catches tickets the Global Mobility team owns by request
      //       type even when the Team field isn't set)
      //   3. All actionable tickets in GMSD (immigration's own project;
      //      no team filter — same actionable rules as HRX)
      // fetchJiraQueueForDept appends `AND statusCategory != Done AND
      // (resolution IS EMPTY OR resolution = Unresolved)` (active) and
      // `AND statusCategory = Done AND resolved >= -24h` (resolved-24h)
      // to each clause before paginating. HRX/GIX overlap on Jira is a
      // known follow-up (post-fetch filter pending); the previous JQL
      // exclusion was reverted after PR #785 dropped every HRX ticket
      // to zero because Jira 3VL treats UNKNOWN-on-missing-field as
      // non-matching under NOT.
      jqlClauses: [
        `project IN (COHD, OSHD) AND "Team[Team]" in ("Global Mobility")`,
        `project = COHD AND "Request Type" = "Mobility Terminations"`,
        `project = GMSD`,
      ],
    },
    workbench: {
      tokenEnvVar: 'DEEL_ADMIN_GIX',
      // 2026-05-22 (afternoon): Mohamed pulled a real Mobility workbench
      // task and verified the Deel-side team membership. Each Deel task
      // belongs to exactly ONE team (`team.id` + `team.name`); the API's
      // `teamIds[]` query param scopes which teams' tasks the caller
      // sees. The three names below ("GSC - Mobility", "Mobility
      // Operations", "GIX") all resolve to the same Deel team UUID
      // `eb6ed10b-aadb-4a08-a695-0a4772f37466` on the immigration
      // backlog he sampled.
      //
      // teamIds[] is the AUTHORITATIVE scope — without it, the upstream
      // call defaults to HRX_OPERATIONS_TEAM_ID which the GIX admin
      // token has no access to (returns 0 silently). teamFilter is a
      // defensive post-fetch name match, kept for the case where Deel
      // ever serves multi-team tasks against this teamId.
      //
      // If Mohamed later confirms GSC - Mobility and Mobility Operations
      // are SEPARATE Deel teams with their own UUIDs, add their UUIDs
      // here too — the array fans out to `teamIds[]=uuid&teamIds[]=...`
      // on the Deel admin call.
      teamIds: ['eb6ed10b-aadb-4a08-a695-0a4772f37466'],
      teamFilter: ['Mobility Operations', 'GSC - Mobility', 'GIX'],
      // Phase 13b (2026-05-20): wired via the per-call adminTokenOverride
      // added to deel-api.js#deelFetch + the post-fetch teamNameFilter
      // in listWorkbenchTasks. HRX is untouched (no overrides passed).
    },
    deelSources: {
      onboarding: false,
      offboarding: false,
      amendments: false,
      redlines: false,
      incentivePlans: false,
      workbench: true,
    },
  },

  // ── Payroll Operations / Benefits Operations ────────────────────────────
  // Empty until mohamed (or a delegated admin) wires their own tokens +
  // filters. Until then, their admins see empty queues — which is the
  // correct fail-closed behavior for a freshly-created dept.
  [PAYROLL_OPERATIONS_SLUG]: {
    deelSources: { ...EMPTY_DEEL_SOURCES },
  },
  [BENEFITS_OPERATIONS_SLUG]: {
    deelSources: { ...EMPTY_DEEL_SOURCES },
  },
};

/**
 * Lookup the full integration profile for a dept by slug. Returns null
 * for unknown depts — callers should fail-closed in that case.
 */
export function getDeptIntegrations(deptSlug) {
  if (!deptSlug) return null;
  return DEPT_INTEGRATIONS[deptSlug] || null;
}

/**
 * Boolean check used by the Deel-source API routes to early-exit when
 * the current dept doesn't want this source rendered.
 */
export function isDeelSourceVisible(deptSlug, sourceKey) {
  const cfg = getDeptIntegrations(deptSlug);
  if (!cfg?.deelSources) return false;
  return cfg.deelSources[sourceKey] === true;
}

/**
 * Return the full {onboarding, offboarding, ...} boolean map for the
 * current dept. Used by /api/v1/dept-scope/current so the FE can hide
 * disabled sections before even fetching.
 */
export function visibleDeelSourcesFor(deptSlug) {
  const cfg = getDeptIntegrations(deptSlug);
  return cfg?.deelSources ? { ...cfg.deelSources } : { ...EMPTY_DEEL_SOURCES };
}

/**
 * Workbench-specific config readout. Returns { token, teamIds, teamFilter }
 * or null if Workbench is not configured for this dept. The token is
 * resolved through process.env so a Nexus rotation kicks in immediately.
 *
 * `teamIds` is the AUTHORITATIVE Deel-side scope — what gets sent as
 * `teamIds[]` to /admin/ops_workbench/tasks. Required for non-HRX depts
 * (their admin tokens don't have access to HRX_OPERATIONS_TEAM_ID).
 * `teamFilter` is a defensive post-fetch name match, layered on top.
 */
export function resolveWorkbenchConfig(deptSlug) {
  const cfg = getDeptIntegrations(deptSlug);
  if (!cfg?.workbench?.tokenEnvVar) return null;
  const token = readEnvResilient(cfg.workbench.tokenEnvVar);
  if (!token) return null;
  return {
    token,
    teamIds: Array.isArray(cfg.workbench.teamIds) && cfg.workbench.teamIds.length > 0
      ? cfg.workbench.teamIds.slice()
      : null,
    teamFilter: cfg.workbench.teamFilter || null,
    tokenSource: cfg.workbench.tokenEnvVar,
  };
}

/**
 * Jira readout. Returns null when Jira is not configured for this dept.
 *
 * Two shapes are supported on `cfg.jira`:
 *   • `jqlClauses: string[]` — preferred. Each clause is a JQL fragment;
 *     the dept fetcher appends active / resolved-24h status suffixes and
 *     fans out one query per clause × bucket, deduping by issue key.
 *   • `projectKeys + ownerFieldValues` — legacy single-clause shorthand;
 *     converted to one `project IN (...) AND "Team[Team]" in (...)`
 *     clause at fetch time. Kept so a brand-new dept can wire a simple
 *     project + team setup without writing JQL.
 */
export function resolveJiraConfig(deptSlug) {
  const cfg = getDeptIntegrations(deptSlug);
  if (!cfg?.jira?.tokenEnvVar) return null;
  const token = readEnvResilient(cfg.jira.tokenEnvVar);
  if (!token) return null;
  return {
    token,
    baseUrl: process.env.JIRA_BASE_URL || '',
    email: process.env.JIRA_USER_EMAIL || '',
    jqlClauses: Array.isArray(cfg.jira.jqlClauses) ? cfg.jira.jqlClauses.slice() : null,
    projectKeys: cfg.jira.projectKeys || [],
    ownerFieldValues: cfg.jira.ownerFieldValues || null,
    tokenSource: cfg.jira.tokenEnvVar,
  };
}

/**
 * Returns the union of every non-HRX dept's Workbench `teamFilter`
 * values, lower-cased and de-duped. HRX's workbench path AND-NOTs these
 * so a task tagged with e.g. teamName="GSC - Mobility" never lands in
 * HRX's queue. Returns null when no other dept has a workbench team
 * filter set.
 *
 * 2026-05-22: there used to be a sibling `getJiraExclusionForHrx()` that
 * composed a `NOT (...)` JQL fragment from other depts' clauses. It was
 * removed after PR #785 because Jira's 3-valued logic dropped EVERY HRX
 * ticket that didn't have the GIX-specific fields set (UNKNOWN inside a
 * NOT filters the row out). Jira HRX/GIX overlap-prevention will return
 * as a POST-FETCH filter in a follow-up — 3VL-safe because we compare
 * actual values in JS, not in JQL. Workbench keeps its exclusion here
 * because that filter runs in JS already.
 */
export function getWorkbenchTeamExclusionForHrx() {
  const out = new Set();
  for (const [slug, cfg] of Object.entries(DEPT_INTEGRATIONS)) {
    if (slug === HR_EXPERIENCE_SLUG) continue;
    if (!Array.isArray(cfg?.workbench?.teamFilter)) continue;
    for (const t of cfg.workbench.teamFilter) {
      if (typeof t === 'string' && t.trim()) out.add(t.trim());
    }
  }
  return out.size > 0 ? Array.from(out) : null;
}

/**
 * Read an env var resilient to common Nexus / K8s casing variants. Some
 * platforms normalize env var names to uppercase on storage; Node's
 * `process.env` is strictly case-sensitive on Linux pods. If our literal
 * name happens to be mixed-case (e.g. `Zendesk_API_Payroll_GIX`), an
 * operator-typed all-caps Nexus entry would never be visible to the
 * code. Try the literal name first; if empty, try ALL_CAPS and
 * lowercase variants so a single typo doesn't take down a whole dept.
 *
 * 2026-05-22 (evening): Mohamed confirmed Zendesk_API_Payroll_GIX was
 * added in Nexus prod twice; new pod at 10:08 still reported
 * "not_configured" from two independent codepaths. The mixed-case
 * literal is the most likely culprit — covering the casing variants
 * here is defence in depth so the wiring doesn't depend on operators
 * matching the exact mixed-case spelling.
 */
export function readEnvResilient(name) {
  if (!name) return '';
  const tried = [name, name.toUpperCase(), name.toLowerCase()];
  for (const variant of tried) {
    const v = process.env[variant];
    if (v) return v;
  }
  return '';
}

/**
 * Zendesk readout. Returns null when not configured for this dept.
 *
 * `groupId` is preferred (Zendesk Search `group_id:<id>` — stable across
 * group renames). `group` (name-based search) stays as a documentation
 * label + last-resort fallback when no ID is available.
 */
export function resolveZendeskConfig(deptSlug) {
  const cfg = getDeptIntegrations(deptSlug);
  if (!cfg?.zendesk?.tokenEnvVar) return null;
  const token = readEnvResilient(cfg.zendesk.tokenEnvVar);
  if (!token) return null;
  const groupId = (cfg.zendesk.groupIdEnvVar && readEnvResilient(cfg.zendesk.groupIdEnvVar))
    || cfg.zendesk.defaultGroupId
    || null;
  return {
    token,
    subdomain: process.env.ZENDESK_SUBDOMAIN || '',
    email: process.env.ZENDESK_EMAIL || '',
    groupId: groupId ? String(groupId) : null,
    group: readEnvResilient(cfg.zendesk.groupEnvVar) || cfg.zendesk.defaultGroup,
    tokenSource: cfg.zendesk.tokenEnvVar,
  };
}

// Exported slug constants for callers that want to compare without
// hardcoding the string in 12 places.
export const SLUGS = {
  HR_EXPERIENCE: HR_EXPERIENCE_SLUG,
  GLOBAL_IMMIGRATION: GLOBAL_IMMIGRATION_SLUG,
  PAYROLL_OPERATIONS: PAYROLL_OPERATIONS_SLUG,
  BENEFITS_OPERATIONS: BENEFITS_OPERATIONS_SLUG,
};

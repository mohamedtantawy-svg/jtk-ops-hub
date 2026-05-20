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

const HR_EXPERIENCE_SLUG = 'hr-experience';
const GLOBAL_IMMIGRATION_SLUG = 'global-immigration';
const PAYROLL_OPERATIONS_SLUG = 'payroll-operations';
const BENEFITS_OPERATIONS_SLUG = 'benefits-operations';

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
      groupEnvVar: 'ZENDESK_GIX_GROUP',
      defaultGroup: 'Immigration Experience',
    },
    jira: {
      tokenEnvVar: 'JIRA_GIX',
      projectKeys: ['COHD', 'OSHD'], // same projects as HRX
      // Filter to the "Global Mobility" team — mohamed's spec said
      // "exactly the same tickets rules as HRX but the team name is
      // Global Mobility". Stored as a list so future co-team setups can
      // share the same Jira surface (e.g. ['Global Mobility', 'GIX-EMEA']).
      ownerFieldValues: ['Global Mobility'],
    },
    workbench: {
      tokenEnvVar: 'DEEL_ADMIN_GIX',
      teamFilter: ['Mobility Operations', 'GSC - Mobility'],
      // Phase 13b follow-up — wiring this requires:
      //   (a) `deel-api.js#deelFetch` to accept a per-call token override
      //       so listWorkbenchTasks can use DEEL_ADMIN_GIX instead of the
      //       module-level DEEL_ADMIN_TOKEN.
      //   (b) The Deel team UUIDs for "Mobility Operations" + "GSC -
      //       Mobility" (the upstream API filters by teamId UUID, not
      //       name). Until then, workbench stays disabled below so the
      //       Global Immigration admin sees empty rather than leaking
      //       HRX's workbench.
    },
    deelSources: {
      onboarding: false,
      offboarding: false,
      amendments: false,
      redlines: false,
      incentivePlans: false,
      workbench: false, // ← Phase 13b enables this once deelFetch accepts a per-call token override.
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
 * Workbench-specific config readout. Returns { token, teamFilter } or
 * null if Workbench is not configured for this dept. The token is
 * resolved through process.env so a Nexus rotation kicks in immediately.
 */
export function resolveWorkbenchConfig(deptSlug) {
  const cfg = getDeptIntegrations(deptSlug);
  if (!cfg?.workbench?.tokenEnvVar) return null;
  const token = process.env[cfg.workbench.tokenEnvVar] || '';
  if (!token) return null;
  return {
    token,
    teamFilter: cfg.workbench.teamFilter || null,
    tokenSource: cfg.workbench.tokenEnvVar,
  };
}

/**
 * Jira readout. Returns null when Jira is not configured for this dept.
 */
export function resolveJiraConfig(deptSlug) {
  const cfg = getDeptIntegrations(deptSlug);
  if (!cfg?.jira?.tokenEnvVar) return null;
  const token = process.env[cfg.jira.tokenEnvVar] || '';
  if (!token) return null;
  return {
    token,
    baseUrl: process.env.JIRA_BASE_URL || '',
    email: process.env.JIRA_USER_EMAIL || '',
    projectKeys: cfg.jira.projectKeys || [],
    ownerFieldValues: cfg.jira.ownerFieldValues || null,
    tokenSource: cfg.jira.tokenEnvVar,
  };
}

/**
 * Zendesk readout. Returns null when not configured for this dept.
 */
export function resolveZendeskConfig(deptSlug) {
  const cfg = getDeptIntegrations(deptSlug);
  if (!cfg?.zendesk?.tokenEnvVar) return null;
  const token = process.env[cfg.zendesk.tokenEnvVar] || '';
  if (!token) return null;
  return {
    token,
    subdomain: process.env.ZENDESK_SUBDOMAIN || '',
    email: process.env.ZENDESK_EMAIL || '',
    group: process.env[cfg.zendesk.groupEnvVar] || cfg.zendesk.defaultGroup,
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

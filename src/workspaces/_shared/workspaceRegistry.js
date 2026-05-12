// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE REGISTRY
//
// The single source of truth for which workspaces exist, who can access them,
// and what tabs each one shows. New workspaces are added here and ONLY here.
//
// Workspaces under `src/workspaces/<team>/` are isolated by ESLint
// (no-restricted-imports) and CODEOWNERS. HR Hub's actual code is the legacy
// app at the `src/` root (App.jsx); it's listed here so the workspace picker
// can render its card alongside the others.
//
// API integrations are intentionally NOT wired. Each workspace will get its
// own credentials later; do not reuse HR's API adapters.
//
// Roster source of truth lives WITH each team under
// `src/workspaces/<team>/data/allowlist.js`. CODEOWNERS protects those files
// so each team can manage its own roster without crossing into shared code.
// ─────────────────────────────────────────────────────────────────────────────

import { PAYROLL_ALLOWED_EMAILS, PAYROLL_ADMINS } from '../payroll/data/allowlist';
import { GIX_ALLOWED_EMAILS, GIX_ADMINS } from '../gix/data/allowlist';

export const WORKSPACE_IDS = {
  HR: 'hr',
  COMMAND_CENTER: 'command-center',
  PAYROLL: 'payroll',
  GIX: 'gix',
};

// localStorage key for the user's most-recent workspace pick from the picker.
export const SELECTED_WORKSPACE_KEY = 'ops_hub_selected_workspace';

// Command Center has a small, leadership-only roster — fine to keep inline.
// Payroll and GIX use larger rosters that live in each team's data/ folder.
export const COMMAND_CENTER_EMAILS = [
  'carlos@deel.com',
  'kento.arrue@deel.com',
  'mohamed.tantawy@deel.com',
];

export const COMMAND_CENTER_ADMINS = [
  'mohamed.tantawy@deel.com',
];

const PAYROLL_GIX_TABS = [
  { id: 'home', label: 'Home' },
  { id: 'team', label: 'Team' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'ooo', label: 'OOO' },
  { id: 'urgent-assist', label: 'Urgent Assist' },
  { id: 'announcements', label: 'Announcements' },
];

// HR-admin override: HR has its own admin model (isHrHubAdmin etc. via App.jsx).
// We don't touch that. But mohamed.tantawy@deel.com is the bootstrap super-admin
// across all workspaces, including HR — listed here only so isWorkspaceAdmin()
// returns the right answer when HR code (or future cross-workspace tooling)
// asks.
const HR_ADMINS = [
  'mohamed.tantawy@deel.com',
];

// All four workspaces, including HR. HR's `tabs` is empty because the legacy
// App.jsx owns its own nav — the registry entry is metadata for the picker
// and for `userHasAccess`.
export const WORKSPACES = {
  [WORKSPACE_IDS.COMMAND_CENTER]: {
    id: WORKSPACE_IDS.COMMAND_CENTER,
    label: 'Command Center',
    description: 'Cross-team overview and metrics for leadership.',
    icon: 'bi-bar-chart-fill',
    accent: '#7c3aed',
    allowedEmails: COMMAND_CENTER_EMAILS,
    admins: COMMAND_CENTER_ADMINS,
    tabs: [
      { id: 'home', label: 'Home' },
    ],
    defaultTab: 'home',
  },
  [WORKSPACE_IDS.HR]: {
    id: WORKSPACE_IDS.HR,
    label: 'HR Hub',
    description: 'HR Operations command center for the HR team.',
    icon: 'bi-people-fill',
    accent: '#ed5e2a',
    allowedEmails: [], // open to anyone authenticated via @deel.com SSO
    admins: HR_ADMINS, // informational only — HR's own isHrHubAdmin flag is canonical
    tabs: [], // HR's App.jsx owns its own nav, not the registry
    defaultTab: null,
  },
  [WORKSPACE_IDS.PAYROLL]: {
    id: WORKSPACE_IDS.PAYROLL,
    label: 'Payroll Hub',
    description: 'Workspace for the Payroll Operations team.',
    icon: 'bi-cash-coin',
    accent: '#10b981',
    allowedEmails: PAYROLL_ALLOWED_EMAILS,
    admins: PAYROLL_ADMINS,
    tabs: PAYROLL_GIX_TABS,
    defaultTab: 'home',
  },
  [WORKSPACE_IDS.GIX]: {
    id: WORKSPACE_IDS.GIX,
    label: 'GIX Hub',
    description: 'Workspace for the Global Immigration team.',
    icon: 'bi-globe2',
    accent: '#3b82f6',
    allowedEmails: GIX_ALLOWED_EMAILS,
    admins: GIX_ADMINS,
    tabs: PAYROLL_GIX_TABS,
    defaultTab: 'home',
  },
};

// Picker order is intentional — Command Center is featured first (cross-team
// visibility), HRX Hub second (largest team), then Payroll, then GIX.
export const PICKER_ORDER = [
  WORKSPACE_IDS.COMMAND_CENTER,
  WORKSPACE_IDS.HR,
  WORKSPACE_IDS.PAYROLL,
  WORKSPACE_IDS.GIX,
];

// Determine which workspace a session should land in.
//   1. `?workspace=<id>` URL param wins (post-auth override only).
//   2. User's explicit pick from the picker (localStorage).
//   3. Anything else → HR Hub (safe default — the legacy App.jsx).
//
// Email allowlists are intentionally NOT used for routing — only for the
// post-resolution access check (`userHasAccess`). This prevents users who
// happen to sit on multiple allowlists (e.g. a Payroll lead who's also on
// the Command Center list) from being auto-routed somewhere unexpected.
// The picker is the canonical way to land in a non-HR workspace; new
// users see it on first sign-in, returning users land in their last
// explicit pick.
//
// Returns one of the WORKSPACE_IDS values.
//
// NOTE: `email` is currently unused by the routing logic, but is kept in
// the signature because callers pass it and it's used elsewhere for access
// checks. Underscore-prefix tells lint we know it's intentional.
//
// eslint-disable-next-line no-unused-vars
export function detectWorkspace({ email: _email, urlParam, selectedWorkspace }) {
  if (urlParam && (urlParam === WORKSPACE_IDS.HR || WORKSPACES[urlParam])) {
    return urlParam;
  }
  if (selectedWorkspace && (selectedWorkspace === WORKSPACE_IDS.HR || WORKSPACES[selectedWorkspace])) {
    return selectedWorkspace;
  }
  return WORKSPACE_IDS.HR;
}

export function getWorkspace(id) {
  return WORKSPACES[id] || null;
}

// Access check applied AFTER the user has authenticated and a workspace has
// been resolved. HR Hub is open to any authenticated user (auth is the gate).
// Empty allowlists are permissive (intentional during rollout while rosters
// aren't confirmed). Populated allowlists are strict.
export function userHasAccess(workspaceId, email) {
  if (!workspaceId) return false;
  if (workspaceId === WORKSPACE_IDS.HR) return true;
  const ws = WORKSPACES[workspaceId];
  if (!ws) return false;
  if (ws.allowedEmails.length === 0) return true;
  if (!email) return false;
  const normalised = String(email).trim().toLowerCase();
  return ws.allowedEmails.some(e => e.toLowerCase() === normalised);
}

// Admin check for a given workspace. NOTE: HR Hub's canonical admin model is
// the legacy `isHrHubAdmin` / `isAccessAdmin` flags on the user object (handled
// by App.jsx); this helper returning true for HR is informational only and
// SHOULD NOT be used to gate HR-Hub admin UI.
export function isWorkspaceAdmin(workspaceId, email) {
  if (!workspaceId || !email) return false;
  const ws = WORKSPACES[workspaceId];
  if (!ws || !ws.admins) return false;
  const normalised = String(email).trim().toLowerCase();
  return ws.admins.some(e => e.toLowerCase() === normalised);
}

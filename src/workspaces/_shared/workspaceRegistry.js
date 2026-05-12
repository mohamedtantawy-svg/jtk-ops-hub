// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE REGISTRY
//
// The single source of truth for which workspaces exist, who can access them,
// and what tabs each one shows. New workspaces are added here and ONLY here.
//
// Workspaces under `src/workspaces/<team>/` are isolated by ESLint
// (no-restricted-imports) and CODEOWNERS. HR Hub is the legacy code at the
// `src/` root and is NOT listed here — it's the default fallback.
//
// API integrations are intentionally NOT wired. Each workspace will get its
// own credentials later; do not reuse HR's API adapters.
// ─────────────────────────────────────────────────────────────────────────────

export const WORKSPACE_IDS = {
  HR: 'hr',
  COMMAND_CENTER: 'command-center',
  PAYROLL: 'payroll',
  GIX: 'gix',
};

// Hardcoded allowlists. Future plan: move to a DB table keyed on email →
// workspace. For now, simple arrays so we don't ship a half-built admin UI.
export const COMMAND_CENTER_EMAILS = [
  'kento.arrue@deel.com',
  'carlos@deel.com',
];

export const PAYROLL_EMAILS = [
  // User will provide list.
];

export const GIX_EMAILS = [
  // User will provide list.
];

// Tab definitions per workspace. Each tab is rendered as a sub-nav button
// in WorkspaceShell. The `view` field maps to the page component imported
// by the workspace app entry (e.g. PayrollApp.jsx).
const PAYROLL_GIX_TABS = [
  { id: 'home', label: 'Home' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'ooo', label: 'OOO' },
  { id: 'urgent-assist', label: 'Urgent Assist' },
  { id: 'announcements', label: 'Announcements' },
];

export const WORKSPACES = {
  [WORKSPACE_IDS.COMMAND_CENTER]: {
    id: WORKSPACE_IDS.COMMAND_CENTER,
    label: 'Command Center',
    allowedEmails: COMMAND_CENTER_EMAILS,
    tabs: [
      { id: 'home', label: 'Home' },
    ],
    defaultTab: 'home',
  },
  [WORKSPACE_IDS.PAYROLL]: {
    id: WORKSPACE_IDS.PAYROLL,
    label: 'Payroll Hub',
    allowedEmails: PAYROLL_EMAILS,
    tabs: PAYROLL_GIX_TABS,
    defaultTab: 'home',
  },
  [WORKSPACE_IDS.GIX]: {
    id: WORKSPACE_IDS.GIX,
    label: 'GIX Hub',
    allowedEmails: GIX_EMAILS,
    tabs: PAYROLL_GIX_TABS,
    defaultTab: 'home',
  },
};

const NON_HR_WORKSPACES = [
  WORKSPACES[WORKSPACE_IDS.COMMAND_CENTER],
  WORKSPACES[WORKSPACE_IDS.PAYROLL],
  WORKSPACES[WORKSPACE_IDS.GIX],
];

// Determine which workspace a session should land in.
//   1. `?workspace=<id>` URL param wins (dev/preview override).
//   2. Email allowlist match for any non-HR workspace.
//   3. Anything else falls through to HR Hub (the existing App.jsx).
//
// Returns one of the WORKSPACE_IDS values.
export function detectWorkspace({ email, urlParam }) {
  if (urlParam && (urlParam === WORKSPACE_IDS.HR || WORKSPACES[urlParam])) {
    return urlParam;
  }
  if (email) {
    const normalised = String(email).trim().toLowerCase();
    for (const ws of NON_HR_WORKSPACES) {
      if (ws.allowedEmails.some(e => e.toLowerCase() === normalised)) {
        return ws.id;
      }
    }
  }
  return WORKSPACE_IDS.HR;
}

export function getWorkspace(id) {
  return WORKSPACES[id] || null;
}

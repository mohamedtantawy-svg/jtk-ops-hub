// Queue constants — copied from src/data/constants.js (HR territory) so the
// workspace queue is fully self-contained. Visual + label parity with HR's
// queue is the goal; if HR's tokens evolve we'll port the changes here.
//
// Per the workspace-isolation guardrail: copy first, generalise later. These
// values change rarely; the duplication cost is small and keeps HR's data
// module unimportable from non-HR workspace code.

export const TOOLS = {
  zendesk:   { label: 'Zendesk',   icon: 'bi-headset',  color: '#29811e', bg: '#e8f5e9', dot: '#29811e' },
  jira:      { label: 'Jira',      icon: 'bi-kanban',   color: '#1565c0', bg: '#e3f2fd', dot: '#1565c0' },
  workbench: { label: 'Workbench', icon: 'bi-tools',    color: '#29811e', bg: '#e8f5e9', dot: '#29811e' },
};

export const STATUSES = {
  new:         { label: 'New',         color: '#1f74b3', bg: '#e8f0fe' },
  in_progress: { label: 'In Progress', color: '#e65100', bg: '#fff3e0' },
  waiting:     { label: 'Pause',       color: '#616161', bg: '#f3f3f3' },
  escalated:   { label: 'Escalated',   color: '#d42d35', bg: '#fef2f2' },
  resolved:    { label: 'Resolved',    color: '#29811e', bg: '#e8f5e9' },
};

export const FUNCTIONS = {
  'Onboarding':       { label: 'Onboarding',   color: '#1f74b3', bg: '#f3eff8' },
  'Offboarding':      { label: 'Offboarding',  color: '#d42d35', bg: '#ffe2de' },
  'Benefits':         { label: 'Benefits',     color: '#c4b1f9', bg: '#f3eff8' },
  'Leave Request':    { label: 'Leave Mgmt',   color: '#1f74b3', bg: '#e8f0fe' },
  'Leave Query':      { label: 'Leave Mgmt',   color: '#1f74b3', bg: '#e8f0fe' },
  'Document Request': { label: 'Documentation', color: '#616161', bg: '#f7f5f2' },
  'Payment Issue':    { label: 'Payroll',      color: '#29811e', bg: '#e8f5e3' },
  'Immigration':      { label: 'Immigration',  color: '#ed8d00', bg: '#fff8e6' },
};

// ISO 3166-1 alpha-2 → flag emoji. Subset of HR's FLAGS — extend as needed.
export const FLAGS = {
  GB:'🇬🇧',US:'🇺🇸',DE:'🇩🇪',FR:'🇫🇷',NL:'🇳🇱',SG:'🇸🇬',BR:'🇧🇷',AU:'🇦🇺',AE:'🇦🇪',CA:'🇨🇦',
  PH:'🇵🇭',IN:'🇮🇳',JP:'🇯🇵',KR:'🇰🇷',ID:'🇮🇩',TH:'🇹🇭',MY:'🇲🇾',VN:'🇻🇳',CN:'🇨🇳',TW:'🇹🇼',HK:'🇭🇰',
  MX:'🇲🇽',CO:'🇨🇴',AR:'🇦🇷',CL:'🇨🇱',PE:'🇵🇪',
  ES:'🇪🇸',IT:'🇮🇹',PT:'🇵🇹',PL:'🇵🇱',RO:'🇷🇴',CZ:'🇨🇿',HU:'🇭🇺',SE:'🇸🇪',NO:'🇳🇴',DK:'🇩🇰',FI:'🇫🇮',IE:'🇮🇪',
  ZA:'🇿🇦',NG:'🇳🇬',KE:'🇰🇪',EG:'🇪🇬',
  IL:'🇮🇱',SA:'🇸🇦',TR:'🇹🇷',PK:'🇵🇰',
  NZ:'🇳🇿',
};

export function getFlag(code) {
  if (!code) return '';
  return FLAGS[String(code).toUpperCase()] || '';
}

// Defaults match HR — see src/utils/helpers.js. Workspace queue uses these
// fallbacks until per-workspace SLA settings ship.
export const SLA_MINS = {
  default: 24 * 60,
  paused:  48 * 60,
};

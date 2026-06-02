// ── HR Hub status lifecycle — single source of truth ───────────────────────
// The six request statuses, with the canonical semantic colour for each.
// Before this module (2026-06-02) the palette was defined THREE times and
// they diverged (live-test findings D5 / I10):
//   • HrHubView.jsx STATUS_FILTERS      — the list (what users see most)
//   • HrHubDetailPanel.jsx STATUS_OPTIONS — the drawer pickers
//   • hr-hub-seed.js DEFAULT_STATUSES   — what the Settings panel renders
// The seed also shipped only FOUR statuses, so the Settings → Statuses tab
// couldn't edit pending_requester or rejected (D4 / I8) even though both are
// valid in the DB CHECK constraint and appear everywhere else.
//
// Status colours are SEMANTIC and deliberately literal (skill rule #30): they
// convey meaning that must NOT shift with light/dark theme, so they are NOT
// CSS vars. `bg` / `tint` back the list's status cards + pills; the seed only
// needs `id` / `label` / `color`. Consumers map this to whatever shape they
// need (the list keys by `value`, the drawer + seed key by `id`).
//
// Adding a status here ALSO requires extending the CHECK constraint on
// hr_hub_request.status (see src/lib/migrate.js) AND bumping
// HR_HUB_SEED_VERSION so existing envs pick it up.

export const HR_HUB_STATUSES = [
  { id: 'new',               label: 'New',               icon: 'bi-circle-fill',       color: '#0369a1', bg: '#e0f2fe', tint: '#bae6fd' },
  { id: 'in_progress',       label: 'In Progress',       icon: 'bi-arrow-repeat',      color: '#d97706', bg: '#fff8e6', tint: '#fde68a' },
  { id: 'pending_requester', label: 'Pending Requester', icon: 'bi-hourglass-split',   color: '#7c3aed', bg: '#f3eff8', tint: '#e9d5ff' },
  { id: 'on_hold',           label: 'On Hold',           icon: 'bi-pause-circle-fill', color: '#737373', bg: '#f5f5f4', tint: '#e7e5e4' },
  { id: 'resolved',          label: 'Resolved',          icon: 'bi-check-circle-fill', color: '#15803d', bg: '#e8f5e9', tint: '#bbf7d0' },
  { id: 'rejected',          label: 'Rejected',          icon: 'bi-x-circle-fill',     color: '#991b1b', bg: '#fee2e2', tint: '#fecaca' },
];

export const HR_HUB_STATUS_BY_ID = Object.fromEntries(HR_HUB_STATUSES.map(s => [s.id, s]));

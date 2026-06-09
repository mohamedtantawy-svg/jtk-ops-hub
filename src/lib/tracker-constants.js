// ── Tracker constants — single source of truth for the generic Tracker engine ──
// 2026-06-09. The "Tracker" tab (renamed from Feedback) hosts board surfaces
// (Ops Hub Feedback / Escalation Zero — feedback_requests) AND spreadsheet
// surfaces backed by the GENERIC tracker engine: a `trackers` table (each
// tracker = a name + an ordered column schema) + a `tracker_rows` table (each
// row = a cells map keyed by column key). Mass Onboarding / Mass Offboarding
// are the first two seeded trackers; team members will build their own later
// by inserting new tracker definitions — no code change.
//
// Pure data + validators only: NO React, NO API, NO DB imports, so this can be
// imported from the routes (server) AND the grid UI (client) without bundling
// the server into the client. Mirrors the escalation-zero-constants.js shape.

// Row lifecycle status — the universal 4-state every spreadsheet tracker uses.
// Status colours stay LITERAL (skill §4.5 — status semantics must not shift
// with theme); the light bg + dark text pill reads in both light + dark mode.
export const TRACKER_ROW_STATUSES = [
  { key: 'new',         label: 'New',         color: '#0369a1', bg: '#e0f2fe', isTerminal: false },
  { key: 'in_progress', label: 'In progress', color: '#d97706', bg: '#fff7ed', isTerminal: false },
  { key: 'blocked',     label: 'Blocked',     color: '#dc2626', bg: '#fef2f2', isTerminal: false },
  { key: 'completed',   label: 'Completed',   color: '#15803d', bg: '#dcfce7', isTerminal: true  },
];

export const TRACKER_ROW_STATUS_KEYS = new Set(TRACKER_ROW_STATUSES.map(s => s.key));
export const DEFAULT_TRACKER_ROW_STATUS = 'new';

export function isValidTrackerStatus(s) {
  return typeof s === 'string' && TRACKER_ROW_STATUS_KEYS.has(s);
}

export function trackerStatusMeta(key) {
  return TRACKER_ROW_STATUSES.find(s => s.key === key) || TRACKER_ROW_STATUSES[0];
}

// Supported column kinds. Each drives a cell editor in the grid + a normaliser
// below. 'status' is special-cased onto the row's own `status` column.
export const TRACKER_COLUMN_KINDS = new Set([
  'text', 'number', 'date', 'member', 'country_multi', 'url', 'status', 'select',
]);

export function isValidColumnKind(k) {
  return typeof k === 'string' && TRACKER_COLUMN_KINDS.has(k);
}

// Managerial role gate — the Mass trackers (and tracker management) are
// managers-only. Agents are excluded entirely (no view, no edit). A future
// per-tracker `visibility:'global'` can relax this for read; mutations stay
// managerial. These role strings match the x-user-role header values
// (accessControl access ids: agent / team_lead / regional_manager / admin).
// The legacy short forms ('lead' / 'regional_mgr') that normaliseRole maps are
// included as belt-and-suspenders so a manager carrying an older un-normalised
// JWT is never wrongly 403'd — agents are still excluded either way.
export const TRACKER_MANAGERIAL_ROLES = ['admin', 'regional_manager', 'team_lead', 'regional_mgr', 'lead'];

export function isManagerialRole(role) {
  return TRACKER_MANAGERIAL_ROLES.includes(role);
}

// Limits — keep JSONB small + reject pathological inputs at the API boundary.
export const TRACKER_LIMITS = {
  name: 120,
  cellText: 2000,
  cells: 60,          // max columns of data on one row
  countries: 60,
  url: 1000,
  rowsPerTracker: 5000,
};

// ── Cell normalisation ──────────────────────────────────────────────────────
// Coerce/clamp a raw cell value to a safe shape for the given column kind.
// Returns the cleaned value (or null when empty). Used by the row POST/PATCH
// routes so a hand-crafted payload can't poison the cells JSONB.
export function normaliseCell(value, kind) {
  switch (kind) {
    case 'number': {
      if (value === '' || value == null) return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'date': {
      // Expect 'YYYY-MM-DD'; reject anything else (don't silently keep junk).
      if (!value) return null;
      const s = String(value).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    }
    case 'country_multi': {
      if (!Array.isArray(value)) return [];
      return [...new Set(
        value
          .map(c => String(c || '').toUpperCase().trim())
          .filter(c => /^[A-Z]{2}$/.test(c)),
      )].slice(0, TRACKER_LIMITS.countries);
    }
    case 'url': {
      if (!value) return null;
      return String(value).slice(0, TRACKER_LIMITS.url);
    }
    case 'member':
    case 'select':
    case 'text':
    default: {
      if (value == null) return null;
      const s = String(value).slice(0, TRACKER_LIMITS.cellText);
      return s.length ? s : null;
    }
  }
}

// Validate + clean a whole column-schema array (the tracker definition). Drops
// columns with no key/label or an unknown kind. Used by tracker create/PATCH.
export function normaliseColumnSchema(schema) {
  if (!Array.isArray(schema)) return [];
  const seen = new Set();
  const out = [];
  for (const col of schema) {
    if (!col || typeof col !== 'object') continue;
    const key = String(col.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const label = String(col.label || '').slice(0, 80).trim();
    const kind = isValidColumnKind(col.kind) ? col.kind : 'text';
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    const entry = { key, label, kind };
    if (kind === 'select' && Array.isArray(col.options)) {
      entry.options = col.options.map(o => String(o || '').slice(0, 60)).filter(Boolean).slice(0, 30);
    }
    if (Number.isFinite(col.width) && col.width > 0) entry.width = Math.min(400, Math.round(col.width));
    out.push(entry);
  }
  return out.slice(0, TRACKER_LIMITS.cells);
}

// Build the cleaned cells object for a row given the tracker's column schema:
// only known column keys survive, each normalised to its column kind.
export function normaliseCells(rawCells, columnSchema) {
  const out = {};
  if (!rawCells || typeof rawCells !== 'object') return out;
  const byKey = new Map((Array.isArray(columnSchema) ? columnSchema : []).map(c => [c.key, c.kind]));
  for (const [k, v] of Object.entries(rawCells)) {
    if (!byKey.has(k)) continue;            // drop unknown columns
    const cleaned = normaliseCell(v, byKey.get(k));
    if (cleaned != null && !(Array.isArray(cleaned) && cleaned.length === 0)) out[k] = cleaned;
  }
  return out;
}

// PATCH variant: keep every KNOWN column key present in the input — even when
// it normalises to null (an emptied cell) — so the JSONB merge sets the key to
// null (= blank) instead of leaving the old value. normaliseCells (used on
// INSERT) drops nulls to keep new rows compact; this one preserves them so an
// inline cell can be CLEARED. Unknown columns are still dropped.
export function normaliseCellsPatch(rawCells, columnSchema) {
  const out = {};
  if (!rawCells || typeof rawCells !== 'object') return out;
  const byKey = new Map((Array.isArray(columnSchema) ? columnSchema : []).map(c => [c.key, c.kind]));
  for (const [k, v] of Object.entries(rawCells)) {
    if (!byKey.has(k)) continue;            // drop unknown columns
    const cleaned = normaliseCell(v, byKey.get(k));
    out[k] = (Array.isArray(cleaned) && cleaned.length === 0) ? null : cleaned;  // null = cleared
  }
  return out;
}

// ── Mass Onboarding / Mass Offboarding shared column schema ───────────────────
// The two seeded trackers share this schema (per Maria Belen Silvestri's
// "Projects spreadsheet" feedback). Stored in trackers.column_schema by the
// seed; the grid renders columns in THIS order.
export const MASS_TRACKER_COLUMNS = [
  { key: 'project',            label: 'Project',             kind: 'text' },
  { key: 'hrx_pm',             label: 'HRX PM',              kind: 'member' },
  { key: 'hrx_pm_backup',      label: 'HRX PM backup',       kind: 'member' },
  { key: 'countries',          label: 'Countries',           kind: 'country_multi' },
  { key: 'eors',               label: 'EORs',                kind: 'text' },
  { key: 'start_date',         label: 'Start date',          kind: 'date' },
  { key: 'end_date',           label: 'End date',            kind: 'date' },
  { key: 'client_poc_emea',    label: 'Client POC (EMEA)',   kind: 'text' },
  { key: 'client_poc_americas',label: 'Client POC (AMER)',   kind: 'text' },
  { key: 'client_poc_apac',    label: 'Client POC (APAC)',   kind: 'text' },
  { key: 'slack_channel',      label: 'Slack channel',       kind: 'url' },
];

// The two built-in board surfaces (feedback_requests-backed) + the seeded grid
// trackers' keys/types, so the FE sub-tab nav + the seed agree on identity.
export const MASS_TRACKER_DEFS = [
  { key: 'mass_onboarding',  name: 'Mass Onboarding',  type: 'mass_onboarding',  sort: 10 },
  { key: 'mass_offboarding', name: 'Mass Offboarding', type: 'mass_offboarding', sort: 20 },
];

// ── Escalation Zero constants (2026-05-21) ─────────────────────────────────
// Single source of truth for the kind='escalation_zero' workflow that lives
// on the Feedback board. Imported by:
//   • CreateFeedbackRequestModal (composer): function dropdown + status init
//   • FeedbackDetailPanel (detail): status transitions + label/color lookup
//   • app/api/v1/feedback/route.js (server validation)
//
// Keep this file pure data — no React imports, no API calls — so it can be
// safely required from both client and server bundles.

// ── HRX function categories (18, from the slack scoping doc) ───────────────
// These are the categories currently in use in the #hrx-escalations-zero
// channel. Renaming a label later is safe — we persist the canonical `key`
// on the row. Adding a new category is a code-only change (no migration
// because keys are stored as free-text strings inside the extras JSONB).
export const ESCALATION_FUNCTIONS = [
  { key: 'onboarding',                 label: 'Onboarding' },
  { key: 'amendments',                 label: 'Amendments' },
  { key: 'termination',                label: 'Termination' },
  { key: 'resignation',                label: 'Resignation' },
  { key: 'redlines',                   label: 'Redlines' },
  { key: 'employment_letters',         label: 'Employment Letters / EVL / Proof of Employment' },
  { key: 'time_off',                   label: 'Time Off' },
  { key: 'health_benefits',            label: 'Health Benefits' },
  { key: 'health_and_safety',          label: 'Health and Safety' },
  { key: 'payroll',                    label: 'Payroll / Payroll Cutoff' },
  { key: 'eor_quotes',                 label: 'EOR Quotes' },
  { key: 'contract_ending',            label: 'Contract Ending' },
  { key: 'country_compliance',         label: 'Country Compliance' },
  { key: 'announcements',              label: 'Announcements' },
  { key: 'internal_tools',             label: 'Internal Tools' },
  { key: 'reporting_and_slas',         label: 'Reporting and SLAs' },
  { key: 'risk_and_escalations',       label: 'Risk & Escalations' },
  { key: 'quality_control',            label: 'Quality Control' },
];

const _FUNCTION_KEYS = new Set(ESCALATION_FUNCTIONS.map(f => f.key));
export function isValidEscalationFunctionKey(key) {
  return typeof key === 'string' && _FUNCTION_KEYS.has(key);
}
export function escalationFunctionLabel(key) {
  const e = ESCALATION_FUNCTIONS.find(f => f.key === key);
  return e ? e.label : key || '';
}

// ── Status workflow ────────────────────────────────────────────────────────
// New → In Review → HRX Execute → On Hold → Resolved → Closed
//
// 'on_hold' is the SLA-pause state — Mohamed's spec: "On Hold status must
// pause SLA timer (needed for litigation cases, legal negotiations, client
// confirmations)". For v1 we only render a visual paused badge; SLA timer
// integration is a follow-up. The `isPaused` flag below carries that
// semantic so future SLA helpers can short-circuit.
//
// 'closed' is the terminal "won't fix / out of scope" state. 'resolved' is
// the terminal "shipped / completed" state. Both archive the row from the
// active board but keep it accessible via the All filter.
export const ESCALATION_STATUSES = [
  { key: 'new',          label: 'New',           color: '#2563eb', bg: '#eff6ff', isOpen: true,  isPaused: false, isTerminal: false },
  { key: 'in_review',    label: 'In Review',     color: '#7c3aed', bg: '#f3eff8', isOpen: true,  isPaused: false, isTerminal: false },
  { key: 'hrx_execute',  label: 'HRX Execute',   color: '#0369a1', bg: '#e0f2fe', isOpen: true,  isPaused: false, isTerminal: false },
  { key: 'on_hold',      label: 'On Hold',       color: '#d97706', bg: '#fff8e6', isOpen: true,  isPaused: true,  isTerminal: false },
  { key: 'resolved',     label: 'Resolved',      color: '#15803d', bg: '#ecfdf5', isOpen: false, isPaused: false, isTerminal: true  },
  { key: 'closed',       label: 'Closed',        color: '#6b7280', bg: '#f4f4f5', isOpen: false, isPaused: false, isTerminal: true  },
];

const _STATUS_KEYS = new Set(ESCALATION_STATUSES.map(s => s.key));
export function isValidEscalationStatus(key) {
  return typeof key === 'string' && _STATUS_KEYS.has(key);
}
export function escalationStatusMeta(key) {
  return ESCALATION_STATUSES.find(s => s.key === key) || ESCALATION_STATUSES[0];
}

// Mirror a canonical 6-state escalation status onto the 5-bucket
// feedback_requests.status column so the shared status index, the list
// status-filter cards, and cross-kind count queries stay consistent. The
// row pill itself always renders from extras.escalationStatus (the true
// 6-state value); this mapping only feeds the DB column.
//   new          → new
//   in_review    → in_progress   (actively being triaged)
//   hrx_execute  → in_progress   (HRX is working it)
//   on_hold      → paused
//   resolved     → done          (shipped / completed)
//   closed       → done          (archived complete; both terminal-success)
const _ESCALATION_STATUS_TO_BUCKET = {
  new: 'new',
  in_review: 'in_progress',
  hrx_execute: 'in_progress',
  on_hold: 'paused',
  resolved: 'done',
  closed: 'done',
};
export function escalationStatusToDbBucket(key) {
  return _ESCALATION_STATUS_TO_BUCKET[key] || 'new';
}

// ── Priority ───────────────────────────────────────────────────────────────
// Standard vs Urgent — the only two values the scoping doc calls out.
// Mapped onto the feedback_requests.priority column (low/medium/high/critical)
// so the existing index + filter UI keeps working:
//   Standard → 'medium'  (the existing default)
//   Urgent   → 'critical'
export const ESCALATION_PRIORITIES = [
  { key: 'standard', label: 'Standard', dbValue: 'medium',   color: '#0369a1' },
  { key: 'urgent',   label: 'Urgent',   dbValue: 'critical', color: '#dc2626' },
];

export function escalationPriorityToDb(priorityKey) {
  const p = ESCALATION_PRIORITIES.find(x => x.key === priorityKey);
  return p ? p.dbValue : 'medium';
}
export function dbPriorityToEscalation(dbValue) {
  const p = ESCALATION_PRIORITIES.find(x => x.dbValue === dbValue);
  return p ? p.key : 'standard';
}

// ── Field limits (from spec: ideal solution up to 10,000 chars) ────────────
// Aligns with WB comment-field bump request in the scoping doc; we go to
// 10k from the start to avoid the second migration the team complained
// about. Server enforces these in the route handler.
export const ESCALATION_FIELD_LIMITS = Object.freeze({
  summaryMin: 0,        // empty summary is rejected by the existing
                        // feedback_requests.title NOT NULL constraint;
                        // FE shows a soft prompt at 20 chars.
  summaryMax: 200,      // mirrors feedback_requests.title VARCHAR(200).
  issueMin: 0,
  issueMax: 10_000,     // ideal solution + summary body share the issue
                        // column (issue = summary body; proposed_resolution
                        // = ideal solution). Bumped to 10k from the
                        // 5k WB limit per the scoping doc.
  resolutionMax: 10_000,
  countriesMax: 50,     // cap on the multi-select; an escalation that
                        // genuinely affects every country gets a Global
                        // banner manually.
  linkUrlMax: 2048,     // standard URL cap.
  shortTextMax: 200,    // single-line fields (reporter, ETA, product name,
                        // product owner, HRX POC).
  textBlockMax: 10_000, // multi-line fields (actionTaken, productComment).
  escalationCount6moMax: 100_000,
});

// ── Resolution track (Product team vs Operations) ──────────────────────────
// Mirrors the xlsx "Reslution on Product / Ops" column — every historical
// escalation was triaged to one of these two. Stored canonical so reports
// can group by it; FE renders the human label.
export const ESCALATION_RESOLUTION_TRACKS = [
  { key: 'product',    label: 'Product',    color: '#7c3aed', bg: '#f3eff8' },
  { key: 'operations', label: 'Operations', color: '#0369a1', bg: '#e0f2fe' },
];

const _TRACK_KEYS = new Set(ESCALATION_RESOLUTION_TRACKS.map(t => t.key));
export function isValidResolutionTrack(key) {
  return typeof key === 'string' && _TRACK_KEYS.has(key);
}
export function resolutionTrackMeta(key) {
  return ESCALATION_RESOLUTION_TRACKS.find(t => t.key === key) || null;
}

// Lightweight ISO date validator — only YYYY-MM-DD is accepted for the
// historical xlsx-imported merged_at column.
const _ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidIsoDate(v) {
  if (typeof v !== 'string') return false;
  if (!_ISO_DATE_RE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return Number.isFinite(d.getTime());
}

// Trim + cap a short text field, returning null if empty post-trim. Used
// by the route validator for reporter / ETA / productName etc. so the
// FE never has to think about "empty string vs missing".
export function normaliseEscalationShortText(input, lim = ESCALATION_FIELD_LIMITS.shortTextMax) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  return s.slice(0, lim);
}
export function normaliseEscalationLongText(input, lim = ESCALATION_FIELD_LIMITS.textBlockMax) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  return s.slice(0, lim);
}
export function normaliseEscalationCount(input) {
  if (input == null || input === '') return null;
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0) return null;
  return Math.min(i, ESCALATION_FIELD_LIMITS.escalationCount6moMax);
}

// ── Extras shape (stored in feedback_requests.extras JSONB) ────────────────
// Reference / documentation only — Postgres doesn't enforce JSONB shape, so
// the server route validates each field individually. This shape is what
// the FE writes and what consumers read.
//
//   {
//     functionKey:     string,   // one of ESCALATION_FUNCTIONS[].key
//     countries:       string[], // ISO 3166-1 alpha-2 codes, uppercase
//     linkedZdUrl:     string,   // optional, full Zendesk ticket URL
//     linkedJiraUrl:   string,   // optional, full Jira issue URL
//     escalationStatus: string,  // one of ESCALATION_STATUSES[].key —
//                                // mirrors top-level status for cross-kind
//                                // FE filtering convenience.
//     priorityKey:     'standard' | 'urgent',
//   }
//
// Server-side validation lives in the feedback route handler; see
// validateEscalationZeroExtras() in app/api/v1/feedback/route.js.

export function defaultEscalationExtras() {
  return {
    functionKey: null,
    countries: [],
    linkedZdUrl: '',
    linkedJiraUrl: '',
    escalationStatus: 'new',
    priorityKey: 'standard',
    // ── Historical-xlsx fields (added 2026-06-01 with the 527-row
    // import from the legacy Slack-channel spreadsheet) ────────────
    reporter: null,            // who flagged it on Slack — display name / handle
    hrxOwnerName: null,        // fallback display name for the HRX owner when
                               // assignee_id doesn't resolve to a live member
    escalationCount6mo: null,  // # of escalations in the prior 6 months
    resolutionTrack: null,     // 'product' | 'operations'
    slackLink: '',             // canonical Slack thread URL
    etaToResolution: null,     // free-text ETA ("Q3", "End of Q2", "2026-10-31")
    actionTaken: null,         // running log of triage actions
    productName: null,         // e.g. "Payroll", "Benefits"
    productOwner: null,        // product team owner (Lucas Faraht, etc)
    hrxPoc: null,              // HRX point-of-contact handling the loop
    productComment: null,      // product team's update / response
    mergedAt: null,            // ISO date when this escalation was merged into another
    importSource: null,        // 'xlsx_v1' for historical imports — used as
                               // a stable conflict key on re-seed
    importExternalId: null,    // deterministic id per source row
  };
}

// Country-code helpers — same constraints used elsewhere in the app.
// Accept any 2-letter ISO code; uppercase for storage consistency.
const _CC_RE = /^[A-Z]{2}$/;
export function normaliseEscalationCountries(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const up = raw.trim().toUpperCase();
    if (!_CC_RE.test(up)) continue;
    if (seen.has(up)) continue;
    seen.add(up);
    out.push(up);
    if (out.length >= ESCALATION_FIELD_LIMITS.countriesMax) break;
  }
  return out;
}

// URL validation — accept http(s) URLs only, length-capped. Empty string
// passes through (means "no link"). Anything malformed or javascript:
// rejected so the detail panel's anchor tags can't be turned into XSS.
export function normaliseEscalationUrl(input) {
  if (typeof input !== 'string') return '';
  const s = input.trim();
  if (!s) return '';
  if (s.length > ESCALATION_FIELD_LIMITS.linkUrlMax) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s;
}

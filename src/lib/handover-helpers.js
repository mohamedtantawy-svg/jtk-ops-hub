// ── Handover & OOO helpers ──────────────────────────────────────────────
// Pure functions shared between the API routes and the UI for handover
// state, date derivation, and visibility decisions. Keep this file free
// of pg / fetch / React imports so it can run on the server or client.

// ── State machine ──────────────────────────────────────────────────────
// HANDOVERS_PLAN.md §8 + HANDOVER_TEMPLATE_REVAMP_PLAN.md §4.2 (TL
// approval removed 2026-05-18). The post-coverage ready state is now
// 'approved' (skipping pending_manager_approval); the lifecycle cron is
// what flips approved → active → completed. PENDING_MANAGER_APPROVAL is
// retained as a constant so historical rows + migrate.js's backfill have
// a name to refer to, but no transition writes it anymore.
export const HANDOVER_STATUSES = Object.freeze({
  DRAFT:                          'draft',
  PENDING_COVERAGE_ACCEPTANCE:    'pending_coverage_acceptance',
  PENDING_MANAGER_APPROVAL:       'pending_manager_approval',
  APPROVED:                       'approved',
  ACTIVE:                         'active',
  COMPLETED:                      'completed',
  REJECTED:                       'rejected',
  CANCELLED:                      'cancelled',
  EXPIRED:                        'expired',
});

export const TERMINAL_STATUSES = Object.freeze(new Set([
  HANDOVER_STATUSES.COMPLETED,
  HANDOVER_STATUSES.REJECTED,
  HANDOVER_STATUSES.CANCELLED,
  HANDOVER_STATUSES.EXPIRED,
]));

export const IN_FLIGHT_STATUSES = Object.freeze(new Set([
  HANDOVER_STATUSES.DRAFT,
  HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE,
  HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL,
  HANDOVER_STATUSES.APPROVED,
  HANDOVER_STATUSES.ACTIVE,
]));

// Status colour legend (matches Calendar bars + Table badges).
// green = approved or active        — coverage is in place
// amber = submitted, pending        — needs acceptance or approval
// red   = OOO with no handover OR only a draft
// slate = entirely in the past
// grey  = cancelled / rejected (rendered for audit recall)
export function handoverStateColor({ handover, eventInPast }) {
  if (eventInPast) return 'slate';
  if (!handover || handover.status === HANDOVER_STATUSES.DRAFT) return 'red';
  if (handover.status === HANDOVER_STATUSES.APPROVED || handover.status === HANDOVER_STATUSES.ACTIVE) return 'green';
  if (handover.status === HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE
   || handover.status === HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL) return 'amber';
  if (handover.status === HANDOVER_STATUSES.CANCELLED
   || handover.status === HANDOVER_STATUSES.REJECTED
   || handover.status === HANDOVER_STATUSES.EXPIRED) return 'grey';
  return 'red';
}

// ── Date helpers ───────────────────────────────────────────────────────
// All time-off / handover dates are date-only (YYYY-MM-DD). The lifecycle
// cron compares against the server's current calendar date in UTC; the UI
// uses the same isoDate() helper so client + server agree on "today".

export function isoDate(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysBetween(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const s = Date.UTC(...startIso.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n)));
  const e = Date.UTC(...endIso.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n)));
  return Math.round((e - s) / 86400000);
}

export function daysUntil(startIso, todayIso = isoDate()) {
  return daysBetween(todayIso, startIso);
}

export function isInRange(dateIso, startIso, endIso) {
  return dateIso >= startIso && dateIso <= endIso;
}

// ── Event timing classification ────────────────────────────────────────
// past   — end_date strictly before today
// active — today is between start_date and end_date (inclusive)
// upcoming — start_date strictly after today
export function eventTiming(event, todayIso = isoDate()) {
  if (!event || !event.end_date || !event.start_date) return 'unknown';
  if (event.end_date < todayIso) return 'past';
  if (event.start_date > todayIso) return 'upcoming';
  return 'active';
}

// ── Country-coverage helpers ───────────────────────────────────────────
// A coverer's country_codes='[]' means "covers everything"; a non-empty
// array narrows the cover to that subset. unionCoveredCountries returns
// the full set of country codes a handover's coverers collectively cover,
// or null when ANY coverer is on full coverage (which implicitly covers
// every country the requester owns — we don't need the requester's own
// country list to evaluate the union).

export function unionCoveredCountries(coverers) {
  if (!Array.isArray(coverers) || coverers.length === 0) return new Set();
  const out = new Set();
  for (const c of coverers) {
    const arr = Array.isArray(c?.country_codes) ? c.country_codes : [];
    if (arr.length === 0) {
      // Full coverage from this coverer — the union is "everything".
      return null;
    }
    for (const cc of arr) {
      if (cc) out.add(String(cc).toUpperCase());
    }
  }
  return out;
}

// ── Lens definitions ───────────────────────────────────────────────────
// One source of truth for the OOO surface's lens IDs. The FE consumes
// LENS_IDS; the API's /handovers/lens-counts returns counts keyed on
// these same IDs. Keep in sync with HANDOVERS_PLAN.md §3. The APPROVALS
// lens was removed 2026-05-18 (HANDOVER_TEMPLATE_REVAMP_PLAN.md §4.2 —
// TL approval is no longer part of the state machine).
export const LENS_IDS = Object.freeze({
  AUTO:      'auto',
  MINE:      'mine',
  COVERING:  'covering',
  TEAM:      'team',
  DRAFTS:    'drafts',
  ALL:       'all',
});

// Lens chip metadata for the UI. Order here is the order shown in the
// header chip row.
export const LENSES = Object.freeze([
  { id: 'mine',      label: 'Mine',         hint: 'My upcoming OOO' },
  { id: 'covering',  label: 'Covering me',  hint: 'OOO handed over to me' },
  { id: 'team',      label: 'My team',      hint: 'OOO in my reporting tree' },
  { id: 'drafts',    label: 'Drafts',       hint: 'My unfinished drafts' },
  { id: 'all',       label: 'All',          hint: 'Everything in scope' },
]);

// Pick the most actionable lens for first-visit users when ?lens= is
// not in the URL. HANDOVERS_PLAN.md §3.1.
//   1. covering if any pending acceptance
//   2. mine if any upcoming OOO missing handover
//   3. team for managers
//   4. mine for everyone else
export function autoLens({ coveringPendingCount, mineMissingCount, isManager }) {
  if (coveringPendingCount > 0) return LENS_IDS.COVERING;
  if (mineMissingCount > 0) return LENS_IDS.MINE;
  if (isManager) return LENS_IDS.TEAM;
  return LENS_IDS.MINE;
}

// ── Audit log event-type constants ─────────────────────────────────────
// Authoritative list of handover_log.event_type values. The lifecycle
// cron + API write handlers use these constants so a typo can't sneak
// past the linter. Mirrors HANDOVERS_PLAN.md §7.7.
export const HANDOVER_EVENT_TYPES = Object.freeze({
  CREATED:                  'created',
  EDITED:                   'edited',
  SUBMITTED:                'submitted',
  COVERER_INVITED:          'coverer_invited',
  COVERER_ACCEPTED:         'coverer_accepted',
  COVERER_DECLINED:         'coverer_declined',
  COVERER_ADDED:            'coverer_added',
  COVERER_REMOVED:          'coverer_removed',
  MANAGER_APPROVED:         'manager_approved',
  MANAGER_REJECTED:         'manager_rejected',
  ACTIVATED:                'activated',
  COMPLETED:                'completed',
  EXTENDED:                 'extended',
  CANCELLED:                'cancelled',
  EXPIRED:                  'expired',
  FORCE_CANCELLED:          'force_cancelled',
  CHECKLIST_ITEM_COMPLETED: 'checklist_item_completed',
  CHECKLIST_ITEM_REOPENED:  'checklist_item_reopened',
  REMINDER_PRE48H_SENT:     'reminder_pre48h_sent',
  REMINDER_PRE24H_SENT:     'reminder_pre24h_sent',
  REMINDER_HANDBACK_SENT:   'reminder_handback_sent',
  HANDBACK_LOGGED:          'handback_logged',
  DATES_DRIFTED:            'dates_drifted',
});

// ── Notification type constants ────────────────────────────────────────
// Mirrors HANDOVERS_PLAN.md §13. The UI uses these to route a
// notification click back to the OOO surface with the right handover id.
export const HANDOVER_NOTIFICATION_TYPES = Object.freeze({
  COVERAGE_INVITED:         'handover_coverage_invited',
  COVERER_ACCEPTED:         'handover_coverer_accepted',
  COVERER_DECLINED:         'handover_coverer_declined',
  PENDING_APPROVAL:         'handover_pending_approval',
  APPROVED:                 'handover_approved',
  REJECTED:                 'handover_rejected',
  STARTING_TOMORROW:        'handover_starting_tomorrow',
  ACTIVE:                   'handover_active',
  HANDBACK_DUE:             'handover_handback_due',
  COMPLETED:                'handover_completed',
  PRE48H_REMINDER:          'handover_pre48h_reminder',
  PRE24H_ALERT:             'handover_pre24h_alert',
  PRE24H_MANAGER_ALERT:     'handover_pre24h_manager_alert',
  CANCELLED:                'handover_cancelled',
  EXPIRED:                  'handover_expired',
  DATES_DRIFTED:            'handover_dates_drifted',
});

// ── Leave-type display (2026-06-09, Derek House "GIX - OOO Tracking") ──────
// Maps a Deel "Policy Type" (time_off_events.leave_type) to a category colour
// for the OOO pills / badges. The label is the raw type — it's already human-
// readable ("Sick leave", "Vacation", "Regional holiday", "Maternity leave",
// …). Colours are semantic + deliberately literal (skill rule #30): a leave
// type conveys meaning that must NOT shift with light/dark theme.
const LEAVE_TYPE_COLOURS = {
  vacation: { color: '#1f74b3', bg: '#e0f2fe' }, // blue
  sick:     { color: '#b91c1c', bg: '#fee2e2' }, // red
  personal: { color: '#7c3aed', bg: '#f3eff8' }, // purple
  holiday:  { color: '#15803d', bg: '#e8f5e9' }, // green — public / regional holiday
  parental: { color: '#be185d', bg: '#fce7f3' }, // pink
  other:    { color: '#6b6560', bg: '#f5f5f4' }, // grey
};
function leaveTypeCategory(t) {
  const s = String(t || '').toLowerCase();
  if (!s) return null;
  if (s.includes('sick')) return 'sick';
  if (s.includes('regional holiday') || s.includes('public holiday')) return 'holiday';
  if (s.includes('matern') || s.includes('patern') || s.includes('parental')
      || s.includes('childbirth') || s.includes('breastfeeding')) return 'parental';
  if (s.includes('personal') || s.includes('childcare') || s.includes('family')) return 'personal';
  if (s.includes('vacation') || s.includes('holiday allowance') || s.includes('paid leave')
      || s.includes('compensatory') || s.includes('supplementary') || s.includes('floating')) return 'vacation';
  return 'other';
}
export function leaveTypeMeta(leaveType) {
  if (!leaveType) return null;
  const category = leaveTypeCategory(leaveType);
  const c = LEAVE_TYPE_COLOURS[category] || LEAVE_TYPE_COLOURS.other;
  return { label: String(leaveType), category, color: c.color, bg: c.bg };
}

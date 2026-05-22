// ── Queue Subject column width — shared resize helpers ─────────────────────
//
// Used by:
//   • Queue.jsx (ZD/Jira ticket table) — base 'ops_hub_queue_subject_width'
//   • SourceTable.jsx (Workbench / Onb / Off / Amend / Redline / IP)
//     — base 'ops_hub_source_subject_width'
//
// Each table persists its own width per signed-in email so two tables with
// very different column counts can stay comfortable independently. The
// affordance (drag handle on the right edge of the Subject header) and the
// CSS variable name '--queue-subject-width' are shared so the styling stays
// consistent across both surfaces.

export const SUBJECT_WIDTH_MIN = 200;
export const SUBJECT_WIDTH_MAX = 900;

export function clampSubjectWidth(n, fallback) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(SUBJECT_WIDTH_MAX, Math.max(SUBJECT_WIDTH_MIN, Math.round(n)));
}

function keyFor(base, email) {
  const lc = (email || '').toLowerCase();
  return lc ? `${base}:${lc}` : base;
}

export function loadStoredSubjectWidth(base, email, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(keyFor(base, email));
    if (!raw) return fallback;
    return clampSubjectWidth(parseInt(raw, 10), fallback);
  } catch { return fallback; }
}

export function saveStoredSubjectWidth(base, email, w) {
  if (typeof window === 'undefined' || !email) return;
  try { localStorage.setItem(keyFor(base, email), String(w)); }
  catch { /* quota / private-mode — width still applies for this session */ }
}

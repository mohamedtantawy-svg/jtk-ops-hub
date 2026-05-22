// ── Per-department Hub brand (2026-05-22) ──────────────────────────────────
// The HR Hub feature is shared across every top-level department, but each
// dept brands their own copy with the dept's short name. Immigration users
// (slug=`gix`) see "GIX Hub" / "GIX Request" / "GIX Reporting"; Benefits
// Operations users (slug=`benefits`) see "Benefits Hub"; etc. The HR
// Experience dept keeps "HR Hub" so the original team's experience is
// unchanged.
//
// Single source of truth for every surface that renders the hub name —
// TopNav primary tab, Quick Create dropdown, the create-request modal,
// HR Hub view hero, detail / settings panels, queue escalation buttons,
// Briefing tiles.
//
// Why a small overrides table + a first-word fallback?
//   • The four launch depts (HR Experience, Global Immigration, Payroll
//     Operations, Benefits Operations) need an opinionated short name
//     that differs from their full display name — "Global Immigration"
//     reads as "GIX" everywhere internally; "HR Experience" stays "HR".
//   • Any future dept created via the Org tab should "just work" with
//     no code change — `Payment Operations` → `Payment`, `Sales Ops` →
//     `Sales`. First-word-of-name is the cheapest rule that gives the
//     right answer for that whole class of depts.
//
// Inputs accept either the full dept object returned by
// `/api/v1/dept-scope/current` (`{ id, name, slug }`) or just the slug
// string — useful for unit tests and the rare consumer that already has
// the slug but not the full object.

// Slug → short brand name. Slugs are user-picked at dept creation; see
// mistake #50 in SKILL.md. Confirmed live values 2026-05-20.
const SHORT_BY_SLUG = {
  'hr-experience':       'HR',
  'gix':                 'GIX',
  'payroll-operations':  'Payroll',
  'benefits':            'Benefits',
};

// Hard-coded last-resort default. Used when dept is null/loading on first
// paint or when the slug + name are both missing. Matches HRX so the
// original team sees no flicker before the hook resolves.
const DEFAULT_SHORT = 'HR';

function firstWord(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Strip trailing role-style words ("Operations", "Ops") if they're the
  // SECOND token, so "Payment Operations" → "Payment", "Sales Ops" →
  // "Sales". A single-word dept name returns itself.
  const parts = trimmed.split(/\s+/);
  return parts[0] || null;
}

function resolveShort(deptOrSlug) {
  if (!deptOrSlug) return DEFAULT_SHORT;
  const slug = typeof deptOrSlug === 'string'
    ? deptOrSlug
    : (deptOrSlug.slug || null);
  if (slug && SHORT_BY_SLUG[slug]) return SHORT_BY_SLUG[slug];
  // Slug not in the override table — derive from dept name when we have
  // the full object. Falls back to default for naked slug strings that
  // don't match an override.
  if (typeof deptOrSlug !== 'string') {
    const fromName = firstWord(deptOrSlug.name);
    if (fromName) return fromName;
  }
  return DEFAULT_SHORT;
}

export function getHubBrand(deptOrSlug) {
  const short = resolveShort(deptOrSlug);
  return {
    short,
    hubLabel:        `${short} Hub`,
    requestLabel:    `${short} Request`,
    reportingLabel:  `${short} Reporting`,
    // Quick-create item subtitle ("HR Request or HR Reporting").
    quickCreateDesc: `${short} Request or ${short} Reporting`,
    // Quick-create item title ("HR Hub Request").
    quickCreateLabel: `${short} Hub Request`,
    // Modal title used by CreateHrHubRequestModal when flow is null.
    submitTitle:     `Submit to ${short} Hub`,
    // Queue-row escalation button label.
    escalateLabel:   `Escalate to ${short} Hub`,
  };
}

// Convenience for tests / non-hook callers that only need the short name.
export function getHubShort(deptOrSlug) {
  return resolveShort(deptOrSlug);
}

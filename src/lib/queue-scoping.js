// ── Unified Queue scoping ───────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for "what can this user see in the Queue" — imported
// by both the FE (Queue.jsx, type-specific panels) and every backend route
// that returns Queue data (/api/v1/queue, /api/v1/integrations/deel/*). Both
// sides must agree; this file is that agreement.
//
// Visibility matrix — uniform across every queue type now (was previously
// split into "assignee-only" and "country-OR-assignee" buckets; the rule
// below collapses both into a single split-by-assignment-status model).
// ──────────────────────────────────────────────────────────────────────────
//                         Assigned to a known    Truly unassigned, or
//                         directory member       assigned only to an orphan
//                         (real employee)        email (departed, external,
//                                                 service account, …)
// ──────────────────────────────────────────────────────────────────────────
// admin                   all                    all
// regional_manager        self + full subtree    country owners (self +
//                         assignees                full subtree)
// team_lead               self + direct-report   country owners (self +
//                         assignees                direct reports)
// agent                   assigned to self       country owners (countries
//                                                  owned by the agent)
// ──────────────────────────────────────────────────────────────────────────
//
// Two key principles:
//
//   1. Assigned (to a real, in-directory member) → ONLY the assignee chain
//      sees it. Country owners outside that chain do NOT have the row in
//      their queue, so reassigning it actually hands it off cleanly.
//
//   2. Unassigned OR orphan-assigned → FALLS BACK to country owners (and
//      their TL/RM/admin chain). "Orphan" means the assignee email isn't
//      in MEMBERS_BY_EMAIL — typically a departed employee, a service
//      account, or an external address. Without this fallback, those rows
//      would be invisible to every operational user (only Admin would see
//      them) and silently rot. The fallback guarantees SOMEONE actionable
//      always sees the row.
//
// This implements the team rule: "if no one is assigned, show it per
// country to the country owners" — and extends it sensibly to cover orphan
// assignments, which are functionally the same problem.
//
// Notes
//   • Country-OR-assignee queues (Onboarding / Paused Onb / Offboarding /
//     Amendments / Redlines) return the UNION of the two filters — a row is
//     visible if EITHER the country path OR the assignee path matches. This
//     is strictly additive vs. each individual filter so no row ever loses
//     visibility relative to the legacy single-mode scoping.
//   • "Unassigned" rows on assignee-only queues (ZD/Jira/Workbench) are
//     visible to team_lead/regional_manager only when their country is in
//     the user's country set. Agents never see unassigned rows on those
//     queues. On country-OR-assignee queues the country path handles
//     unassigned rows automatically (no primary assignee → visible iff
//     country matches the user's country set).
//   • getVisibleCountries derives from the ownership map (OWNER_COUNTRIES)
//     and walks exactly the same hierarchy the assignee filter uses, so the
//     two modes stay consistent: a TL "sees" the same set of people for both.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getVisibleEmailsForAccess,
  getDirectReports,
  getAllReports,
  MEMBERS_BY_EMAIL,
  ALL_EMAILS_SET,
} from '../data/members.js';
import { OWNER_COUNTRIES, COUNTRY_OWNERS } from '../data/countryOwners.js';

// Every country anyone owns — admin baseline + fallback when data is sparse.
const ALL_COUNTRIES = new Set(Object.keys(COUNTRY_OWNERS));

// ── Role resolution ─────────────────────────────────────────────────────────
// On the backend, JWT payload gives us `user.role`. On the frontend the same
// shape comes from App.jsx's `user`. Fall back to MEMBERS_BY_EMAIL so missing
// roles still map correctly. Case-normalize both the lookup key and the
// resolved role so "Admin" / "AGENT" / "Team_Lead" all behave the same.
//
// When we hit the fallback (no explicit role + no directory match) we emit a
// single dev-mode warning so orphaned users surface in logs instead of being
// silently demoted to 'agent'.
const _warnedFallback = typeof globalThis !== 'undefined' ? (globalThis.__queueScopeWarned ||= new Set()) : new Set();
function normalizeRole(user) {
  if (!user) return null;
  if (user.role) return String(user.role).toLowerCase();
  const email = (user.email || '').toLowerCase();
  const m = MEMBERS_BY_EMAIL[email];
  if (m?.access) return String(m.access).toLowerCase();
  if (email && !_warnedFallback.has(email)) {
    _warnedFallback.add(email);
    // Don't log noise in production for legit agents; only warn when both the
    // JWT role AND the directory lookup miss.
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      console.warn(`[queue-scoping] No role for ${email}; defaulting to 'agent'. Add to MEMBERS or set role in JWT.`);
    }
  }
  return 'agent';
}

export function isAdminUser(user) {
  return normalizeRole(user) === 'admin';
}

// ── Visible emails ─────────────────────────────────────────────────────────
export function getVisibleEmails(user) {
  if (!user || !user.email) return new Set();
  if (isAdminUser(user)) return ALL_EMAILS_SET;
  return getVisibleEmailsForAccess(user.email);
}

// ── Visible countries ──────────────────────────────────────────────────────
// Aggregates OWNER_COUNTRIES across every email the user can "see", where the
// hierarchy is defined exactly as for assignee visibility so the two modes
// stay consistent.
export function getVisibleCountries(user) {
  if (!user || !user.email) return new Set();
  const role = normalizeRole(user);
  if (role === 'admin') return ALL_COUNTRIES;

  const email = user.email.toLowerCase();
  let emails;
  if (role === 'regional_manager') {
    emails = new Set([email, ...getAllReports(email)]);
  } else if (role === 'team_lead') {
    emails = new Set([email, ...getDirectReports(email).map(r => r.email.toLowerCase())]);
  } else {
    emails = new Set([email]);
  }

  const countries = new Set();
  for (const e of emails) {
    const owned = OWNER_COUNTRIES.get(e);
    if (owned) for (const c of owned) countries.add(c);
  }
  return countries;
}

// ── Filter helpers ─────────────────────────────────────────────────────────

/**
 * Core scoping rule — split by ASSIGNMENT STATUS.
 *
 *   • Assigned to a known directory member (primary or any secondary):
 *     only the assignee chain sees the row (assignee + their TL + their RM
 *     + admin). Country owners outside that chain do NOT get it.
 *   • Otherwise — truly unassigned OR all-assignees-orphan (departed,
 *     external, service account): falls back to country owners. The row
 *     is visible iff its country is in the user's visibleCountries.
 *
 * Treating orphan-assigned the same as unassigned is critical for
 * task-stranding prevention. A row pointed at e.g. a former employee's
 * email would otherwise be invisible to every operational user; the
 * country fallback guarantees the country owner (and their lead chain)
 * still sees it.
 *
 * Secondary assignees (Jira only): items may carry
 * `secondaryAssigneeEmails` from custom fields like Country Owner /
 * Task Owner / Process Owner / Team Responsible. Any of those emails
 * that resolve in MEMBERS_BY_EMAIL count as "assigned to a real
 * member" for the purposes of this rule.
 */
function _scopeByAssignedOrUnassigned(items, user) {
  if (!Array.isArray(items)) return [];
  if (!user) return [];
  if (isAdminUser(user)) return items;

  const visibleEmails = getVisibleEmails(user);
  const visibleCountries = getVisibleCountries(user);

  return items.filter(item => {
    const primary = (item.assigneeEmail || '').toLowerCase();
    const secondaries = Array.isArray(item.secondaryAssigneeEmails)
      ? item.secondaryAssigneeEmails.map(e => (e || '').toLowerCase()).filter(Boolean)
      : [];

    const primaryIsKnown = !!(primary && MEMBERS_BY_EMAIL[primary]);
    const knownSecondaries = secondaries.filter(s => !!MEMBERS_BY_EMAIL[s]);

    // Real assignment to an in-directory member: assignee chain only.
    if (primaryIsKnown || knownSecondaries.length > 0) {
      if (primaryIsKnown && visibleEmails.has(primary)) return true;
      for (const s of knownSecondaries) {
        if (visibleEmails.has(s)) return true;
      }
      return false;
    }

    // Truly unassigned, or assigned only to orphan emails (departed
    // employee, external address, service account, …): fall back to the
    // country-owner chain. Without this, orphan-assigned rows would be
    // invisible to every operational user.
    const cc = (item.country || item.countryCode || '').toUpperCase();
    return !!cc && visibleCountries.has(cc);
  });
}

/**
 * Assignee-mode filter — Zendesk, Jira, Offboarding, Workbench.
 * See _scopeByAssignedOrUnassigned for the actual rule.
 *
 * @param {Array}  items
 * @param {Object} user  — must have `email`; may have `role` set by JWT
 */
export function filterByAssignee(items, user) {
  return _scopeByAssignedOrUnassigned(items, user);
}

/**
 * Country-mode filter — used internally by filterByCountryOrAssignee.
 *
 *   • An item is visible when its `country` is in the user's visible-country
 *     set. Admin sees everything.
 *   • Items without a country are only visible to admins — every other role
 *     needs a country to establish ownership.
 *
 * @param {Array}  items
 * @param {Object} user
 */
export function filterByCountry(items, user) {
  if (!Array.isArray(items)) return [];
  if (!user) return [];
  if (isAdminUser(user)) return items;

  const visibleCountries = getVisibleCountries(user);
  if (visibleCountries.size === 0) return [];
  return items.filter(item => {
    const cc = (item.country || item.countryCode || '').toUpperCase();
    return !!cc && visibleCountries.has(cc);
  });
}

/**
 * Combined filter — Onboarding, Paused Onboarding, Offboarding, Amendments,
 * Redlines. Same rule as filterByAssignee now (split by assignment status,
 * orphan-as-unassigned fallback). Kept as a separate symbol so future
 * divergence between queue types is a one-line change.
 */
export function filterByCountryOrAssignee(items, user) {
  return _scopeByAssignedOrUnassigned(items, user);
}

// ── Named wrappers so call sites read like the spec ────────────────────────
// Every queue type uses the same split-by-assignment rule today
// (assigned-to-real-member → assignee chain only; otherwise → country
// owners). The two filter symbols stay separate so a single queue can
// diverge later without touching all callers.
export const scopeZendeskTickets   = (items, user) => filterByAssignee(items, user);
export const scopeJiraIssues       = (items, user) => filterByAssignee(items, user);
export const scopeWorkbenchTasks   = (items, user) => filterByAssignee(items, user);

export const scopeOnboardingPeople      = (items, user) => filterByCountryOrAssignee(items, user);
export const scopePausedOnboarding      = (items, user) => filterByCountryOrAssignee(items, user);
export const scopeOffboardingCases      = (items, user) => filterByCountryOrAssignee(items, user);
export const scopeAmendmentRequests     = (items, user) => filterByCountryOrAssignee(items, user);
export const scopeRedlineRequests       = (items, user) => filterByCountryOrAssignee(items, user);

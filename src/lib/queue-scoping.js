// ── Unified Queue scoping ───────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for "what can this user see in the Queue" — imported
// by both the FE (Queue.jsx, type-specific panels) and every backend route
// that returns Queue data (/api/v1/queue, /api/v1/integrations/deel/*). Both
// sides must agree; this file is that agreement.
//
// Visibility matrix
// ──────────────────────────────────────────────────────────────────────────
//                         Assignee-based         Country-based
//                         (ZD, Jira,             (Onboarding,
//                          Offboarding,           Paused Onboarding,
//                          Workbench)             Amendments, Redlines)
// ──────────────────────────────────────────────────────────────────────────
// admin                   all                    all
// regional_manager        self + full subtree    union of owned countries
//                         assignees + unassigned across self + full subtree
//                         in subtree countries
// team_lead               self + direct-report   union of owned countries
//                         assignees + unassigned across self + direct reports
//                         in team countries
// agent                   assigned to self       own owned countries only
//                         (no unassigned)
// ──────────────────────────────────────────────────────────────────────────
//
// Notes
//   • "Unassigned" rows are visible to team_lead/regional_manager only when
//     their country is in the user's country set. Agents never see
//     unassigned rows — an unassigned termination doesn't belong to them.
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
 * Assignee-mode filter — Zendesk, Jira, Offboarding, Workbench.
 *
 *   • Assigned items: visible when `assigneeEmail` is in the user's
 *     visible-email set.
 *   • Unassigned items: invisible to agents. TL / RM see them only when
 *     their `country` (uppercase ISO-ish code) is in the user's
 *     visible-country set. Admins see everything.
 *
 * @param {Array}  items
 * @param {Object} user  — must have `email`; may have `role` set by JWT
 * @param {Object} opts  — { allowUnassignedForLeadsByCountry = true }
 */
export function filterByAssignee(items, user, opts = {}) {
  if (!Array.isArray(items)) return [];
  if (!user) return [];
  if (isAdminUser(user)) return items;

  const visibleEmails = getVisibleEmails(user);
  const role = normalizeRole(user);
  const allowUnassigned = opts.allowUnassignedForLeadsByCountry !== false
    && (role === 'team_lead' || role === 'regional_manager');
  const visibleCountries = allowUnassigned ? getVisibleCountries(user) : null;

  return items.filter(item => {
    const email = (item.assigneeEmail || '').toLowerCase();
    if (email) return visibleEmails.has(email);
    // Unassigned
    if (!allowUnassigned) return false;
    const cc = (item.country || item.countryCode || '').toUpperCase();
    return !!cc && visibleCountries.has(cc);
  });
}

/**
 * Country-mode filter — Onboarding, Paused Onboarding, Amendments, Redlines.
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

// ── Named wrappers so call sites read like the spec ────────────────────────
// These are the only functions call sites should use. Swapping the rule for
// a single queue later then means editing exactly one line here.

export const scopeZendeskTickets   = (items, user) => filterByAssignee(items, user);
export const scopeJiraIssues       = (items, user) => filterByAssignee(items, user);
export const scopeOffboardingCases = (items, user) => filterByAssignee(items, user);
export const scopeWorkbenchTasks   = (items, user) => filterByAssignee(items, user);

export const scopeOnboardingPeople      = (items, user) => filterByCountry(items, user);
export const scopePausedOnboarding      = (items, user) => filterByCountry(items, user);
export const scopeAmendmentRequests     = (items, user) => filterByCountry(items, user);
export const scopeRedlineRequests       = (items, user) => filterByCountry(items, user);

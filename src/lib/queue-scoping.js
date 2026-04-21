// ── Unified Queue scoping ───────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for "what can this user see in the Queue" — imported
// by both the FE (Queue.jsx, type-specific panels) and every backend route
// that returns Queue data (/api/v1/queue, /api/v1/integrations/deel/*). Both
// sides must agree; this file is that agreement.
//
// Visibility matrix
// ──────────────────────────────────────────────────────────────────────────
//                         Assignee-only          Country OR Assignee
//                         (ZD, Jira,             (Onboarding, Paused
//                          Workbench)             Onboarding, Offboarding,
//                                                 Amendments, Redlines)
// ──────────────────────────────────────────────────────────────────────────
// admin                   all                    all
// regional_manager        self + full subtree    UNION of assignee match
//                         assignees + unassigned   (self + full subtree)
//                         in subtree countries     AND country match (countries
//                                                  owned by self + full subtree)
// team_lead               self + direct-report   UNION of assignee match
//                         assignees + unassigned   (self + direct reports)
//                         in team countries        AND country match (countries
//                                                  owned by self + direct reports)
// agent                   assigned to self       self-assigned OR self-owned
//                         (no unassigned)          country
// ──────────────────────────────────────────────────────────────────────────
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
 * Assignee-mode filter — Zendesk, Jira, Offboarding, Workbench.
 *
 *   • Assigned items: visible when `assigneeEmail` is in the user's
 *     visible-email set.
 *   • Secondary assignees (Jira only): items also carry
 *     `secondaryAssigneeEmails` — emails pulled from custom fields like
 *     Country Owner / Task Owner / Process Owner / Team Responsible. An item
 *     is visible if ANY of those matches the user's visible-email set, so a
 *     Country Owner can see their region's tickets without being the Jira
 *     assignee.
 *   • Unassigned items (no primary AND no secondary): invisible to agents.
 *     TL / RM see them only when their `country` (uppercase ISO-ish code) is
 *     in the user's visible-country set. Admins see everything.
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
    const primary = (item.assigneeEmail || '').toLowerCase();
    const secondary = Array.isArray(item.secondaryAssigneeEmails)
      ? item.secondaryAssigneeEmails.map(e => (e || '').toLowerCase()).filter(Boolean)
      : [];

    // Match on primary assignee OR any secondary-owner role.
    if (primary && visibleEmails.has(primary)) return true;
    for (const s of secondary) {
      if (visibleEmails.has(s)) return true;
    }

    // No primary and no secondary → treat as unassigned.
    if (!primary && secondary.length === 0) {
      if (!allowUnassigned) return false;
      const cc = (item.country || item.countryCode || '').toUpperCase();
      return !!cc && visibleCountries.has(cc);
    }
    return false;
  });
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
 * Redlines.
 *
 * Union of filterByCountry AND filterByAssignee. A row is visible when EITHER
 * path matches:
 *
 *   • Country path — item.country is in the user's visible-country set (self
 *     + subtree for TL/RM). This is how country owners see their region's
 *     work even when they are not the Jira/Deel assignee.
 *   • Assignee path — item.assigneeEmail (or any secondaryAssigneeEmails) is
 *     in the user's visible-email set. This is how an assignee's chain
 *     (the assignee, their TL, their RM) sees the row, even when the row's
 *     country is not one they own.
 *
 * The union is strictly additive vs. either filter individually — no row is
 * hidden here that either filter would have surfaced on its own. Admins see
 * everything (early return in each filter).
 *
 * @param {Array}  items
 * @param {Object} user
 */
export function filterByCountryOrAssignee(items, user) {
  if (!Array.isArray(items)) return [];
  if (!user) return [];
  if (isAdminUser(user)) return items;

  // Dedupe by identity — an item matched by both paths must appear once.
  // Prefer a stable id key; fall back to the object reference (Set membership
  // by reference is fine here because filter() returns original refs).
  const seen = new Set();
  const visible = [];
  for (const bucket of [filterByCountry(items, user), filterByAssignee(items, user)]) {
    for (const item of bucket) {
      const key = item && item.id != null ? `id:${item.id}` : item;
      if (seen.has(key)) continue;
      seen.add(key);
      visible.push(item);
    }
  }
  return visible;
}

// ── Named wrappers so call sites read like the spec ────────────────────────
// These are the only functions call sites should use. Swapping the rule for
// a single queue later then means editing exactly one line here.
//
// Assignee-only (spec: "visibility based on assignee to the assignee, their
// team leads and their regional managers"). Jira retains secondary-assignee
// surfacing (Country Owner / Task Owner / Process Owner / Team Responsible
// custom fields) so HRX managers continue to see tickets tagged to them via
// any of those fields — removing that would strip visibility from country
// owners currently relying on it.
export const scopeZendeskTickets   = (items, user) => filterByAssignee(items, user);
export const scopeJiraIssues       = (items, user) => filterByAssignee(items, user);
export const scopeWorkbenchTasks   = (items, user) => filterByAssignee(items, user);

// Country-OR-assignee (spec: "visible to country owners, their team leads
// and their regional manager OR if the task is assigned to them"). The
// union guarantees strictly additive visibility — nobody who saw a row
// under the previous single-mode scoping loses access.
export const scopeOnboardingPeople      = (items, user) => filterByCountryOrAssignee(items, user);
export const scopePausedOnboarding      = (items, user) => filterByCountryOrAssignee(items, user);
export const scopeOffboardingCases      = (items, user) => filterByCountryOrAssignee(items, user);
export const scopeAmendmentRequests     = (items, user) => filterByCountryOrAssignee(items, user);
export const scopeRedlineRequests       = (items, user) => filterByCountryOrAssignee(items, user);

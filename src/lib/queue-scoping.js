// ── Unified Queue scoping ───────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for "what can this user see in the Queue" — imported
// by both the FE (Queue.jsx, type-specific panels) and every backend route
// that returns Queue data (/api/v1/queue, /api/v1/integrations/deel/*). Both
// sides must agree; this file is that agreement.
//
// Visibility matrix — two distinct rules per queue type (per team spec).
// ──────────────────────────────────────────────────────────────────────────
//                         Assignee-only chain     Country-OR-assignee union
//                         (ZD / Jira / Workbench) (Onb / Paused Onb / Off /
//                                                  Amendments / Redlines)
// ──────────────────────────────────────────────────────────────────────────
// admin                   all                     all
// regional_manager        assigned to self +      anything in countries
//                         full subtree            owned by self + subtree
//                                                 OR assigned to anyone in
//                                                 the subtree
// team_lead               assigned to self +      anything in countries
//                         direct reports          owned by self + direct
//                                                 reports OR assigned to
//                                                 self + direct reports
// agent                   assigned to self        anything in countries the
//                                                 agent owns OR assigned
//                                                 to the agent
// ──────────────────────────────────────────────────────────────────────────
//
// Two key principles:
//
//   1. Ticket queues (ZD / Jira / Workbench) — ASSIGNEE-CHAIN ONLY.
//      Show to the assignee, their TL, their RM, admin. Country owners
//      outside the chain do NOT see assigned-to-other rows. To prevent
//      task-stranding, rows whose primary assignee is empty OR resolves
//      to an orphan email (departed user / service account / external
//      address) fall back to the country-owner chain so SOMEONE actionable
//      always sees them.
//
//   2. Country queues (Onb / Paused Onb / Off / Amend / Redline) — UNION.
//      Country owners see everything in their owned countries regardless
//      of who's currently assigned. The assignee chain ALSO sees the row
//      (so an out-of-country assignee still gets it). Reassigning a row
//      adds a viewer; it doesn't remove the country owner.
//
// The split mirrors how the team actually operates: tickets have a clear
// owner (assignee), country queues are owned by the country owner who
// triages and routes work into them.
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
import { getActiveHandoverDelegationsSync } from './handover-scope-cache.js';

// Every country anyone owns — admin baseline + fallback when data is sparse.
// Computed lazily so a hydrateOwnerCountries() update from
// roster-server.js or useTeamCountryOwnership is reflected on the next
// scoping call without a redeploy.
function getAllCountries() {
  return new Set(Object.keys(COUNTRY_OWNERS || {}));
}

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
// Phase 3 — getVisibleEmails additionally folds in every requester whose
// handover is currently `active` (or `approved` and inside the date
// window) AND lists the caller as an accepted coverer. The delegation
// data lives in the in-memory handover-scope-cache, populated at boot
// and refreshed on every handover write + every 60 s. Admins are
// short-circuited; they already see everything.
export function getVisibleEmails(user) {
  if (!user || !user.email) return new Set();
  if (isAdminUser(user)) return ALL_EMAILS_SET;
  const base = getVisibleEmailsForAccess(user.email);
  const delegations = getActiveHandoverDelegationsSync(user.email);
  if (delegations.length === 0) return base;
  for (const d of delegations) {
    if (d?.requesterEmail) base.add(d.requesterEmail);
  }
  return base;
}

// ── Visible countries ──────────────────────────────────────────────────────
// Aggregates OWNER_COUNTRIES across every email the user can "see", where the
// hierarchy is defined exactly as for assignee visibility so the two modes
// stay consistent.
//
// Phase 3 — additionally adds the delegated country set. If a coverer
// row carries an empty `countries` array we treat that as full coverage
// of the requester's owned countries; if it carries an explicit subset
// we add ONLY those codes. Either way the merge is additive: the
// coverer's pre-existing country set is never narrowed.
export function getVisibleCountries(user) {
  if (!user || !user.email) return new Set();
  const role = normalizeRole(user);
  if (role === 'admin') return getAllCountries();

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

  // Phase 3 — fold in delegated countries.
  const delegations = getActiveHandoverDelegationsSync(email);
  for (const d of delegations) {
    if (!d?.requesterEmail) continue;
    if (!d.countries || d.countries.size === 0) {
      // Full coverage — add every country the requester owns.
      const owned = OWNER_COUNTRIES.get(d.requesterEmail);
      if (owned) for (const c of owned) countries.add(c);
    } else {
      for (const c of d.countries) countries.add(c);
    }
  }

  return countries;
}

// ── Filter helpers ─────────────────────────────────────────────────────────

/**
 * Assignee-only rule (with safety fallback) — used by ZD / Jira / Workbench.
 *
 *   • Assigned to a known directory member (primary or any secondary):
 *     only the assignee chain sees the row (assignee + their TL + their RM
 *     + admin). Country owners outside that chain do NOT get it.
 *   • Otherwise — truly unassigned OR all-assignees-orphan (departed,
 *     external, service account): falls back to country owners. Without
 *     this, orphan-assigned tickets would be invisible to every
 *     operational user.
 *
 * Secondary assignees (Jira only): items may carry
 * `secondaryAssigneeEmails` from custom fields like Country Owner /
 * Task Owner / Process Owner / Team Responsible. Any of those emails
 * that resolve in MEMBERS_BY_EMAIL count as "assigned to a real
 * member".
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

    if (primaryIsKnown || knownSecondaries.length > 0) {
      if (primaryIsKnown && visibleEmails.has(primary)) return true;
      for (const s of knownSecondaries) {
        if (visibleEmails.has(s)) return true;
      }
      return false;
    }

    const cc = (item.country || item.countryCode || '').toUpperCase();
    return !!cc && visibleCountries.has(cc);
  });
}

/**
 * Country-OR-assignee rule (UNION) — used by Onboarding / Paused Onboarding /
 * Offboarding / Amendments / Redlines.
 *
 * A row is visible if EITHER:
 *   • the row's country is in the user's visibleCountries (country owner +
 *     their lead chain), OR
 *   • the row's primary or secondary assignee is in the user's
 *     visibleEmails (assignee chain).
 *
 * This is the broader "country owners always see their region's queue work"
 * model the team explicitly asked for on Onb/Off/Redlines: a country owner
 * picks up everything in their country, even if it's already been routed to
 * a specific person.
 */
function _scopeCountryOrAssignee(items, user) {
  if (!Array.isArray(items)) return [];
  if (!user) return [];
  if (isAdminUser(user)) return items;

  const visibleEmails = getVisibleEmails(user);
  const visibleCountries = getVisibleCountries(user);

  return items.filter(item => {
    const cc = (item.country || item.countryCode || '').toUpperCase();
    if (cc && visibleCountries.has(cc)) return true;

    const primary = (item.assigneeEmail || '').toLowerCase();
    if (primary && visibleEmails.has(primary)) return true;

    const secondaries = Array.isArray(item.secondaryAssigneeEmails)
      ? item.secondaryAssigneeEmails.map(e => (e || '').toLowerCase()).filter(Boolean)
      : [];
    for (const s of secondaries) {
      if (visibleEmails.has(s)) return true;
    }
    return false;
  });
}

/**
 * Assignee-mode filter — Zendesk, Jira, Workbench.
 * Strict assignee-chain visibility, with a country-fallback only when the
 * primary assignee is empty or an orphan (so unowned tickets aren't
 * stranded).
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
 * Country-OR-assignee filter — Onboarding, Paused Onboarding, Offboarding,
 * Amendments, Redlines. A row is visible if the user owns the row's country
 * OR is in the row's assignee chain. Country owners see their region's
 * queue regardless of who's currently assigned.
 */
export function filterByCountryOrAssignee(items, user) {
  return _scopeCountryOrAssignee(items, user);
}

// ── Named wrappers so call sites read like the spec ────────────────────────
// Two distinct visibility models:
//   • Assignee-only chain (with orphan-fallback) — ZD / Jira / Workbench.
//     Show to the assignee, their TL, their RM, and admin. Unowned /
//     orphaned tickets fall to country owners so they aren't stranded.
//   • Country-OR-assignee union — Onb / Paused Onb / Off / Amend / Redline.
//     Show to country owners (plus their lead chain) AND the assignee chain.
//     Country owners see their region's queue even when rows are pre-routed.
export const scopeZendeskTickets   = (items, user) => filterByAssignee(items, user);
export const scopeJiraIssues       = (items, user) => filterByAssignee(items, user);
export const scopeWorkbenchTasks   = (items, user) => filterByAssignee(items, user);

// Agents see ASSIGNEE-only (with country fallback only for orphan rows),
// while TL / Regional / Admin keep the broader country-OR-assignee union so
// they retain visibility into their team's / region's full pipeline.
//
// First applied to Offboarding on 2026-04-28 after Raquel reported seeing
// the entire UK team's offboarding queue. Extended to every other
// country-OR-assignee surface on 2026-05-12 — Raquel raised the same bug
// on Amendments ("When I am working on my task, I can see tasks for
// other HRX under the same country, meaning that the volume of tasks is
// more than it should be"). Mohamed approved extending the agent-strict
// rule across the board: agents now see only THEIR row on every queue,
// managers still see the full country/team picture.
//
// `assigneeEmail` is reliably populated on every row because the
// synthetic-owner shim in `normalizeSourceRows.js` fills it from
// COUNTRY_OWNERS (hash-balanced round-robin) for queues without an
// upstream assignee (Amendments, Redlines, Incentive Plans). So the
// strict assignee filter is meaningful on every queue here.
const scopeAgentOrUnion = (items, user) => {
  if (normalizeRole(user) === 'agent') return filterByAssignee(items, user);
  return filterByCountryOrAssignee(items, user);
};

export const scopeOnboardingPeople      = (items, user) => scopeAgentOrUnion(items, user);
export const scopePausedOnboarding      = (items, user) => scopeAgentOrUnion(items, user);
export const scopeOffboardingCases      = (items, user) => scopeAgentOrUnion(items, user);
export const scopeAmendmentRequests     = (items, user) => scopeAgentOrUnion(items, user);
export const scopeRedlineRequests       = (items, user) => scopeAgentOrUnion(items, user);
export const scopeIncentivePlans        = (items, user) => scopeAgentOrUnion(items, user);

// ---------------------------------------------------------------------------
// Server-side scope helpers — single source of truth shared with the FE.
//
// The org hierarchy lives in src/data/members.js (TEAM_MEMBERS + managerEmail).
// Both the React client and the Next.js API routes import from the same file,
// so the scope that the server enforces is byte-identical to what the client
// expects to see.
//
//   admin            → every member email
//   regional_manager → self + entire subtree below (walked via managerEmail)
//   team_lead        → self + direct reports (one hop)
//   agent            → self only
//
// Callers pass in the { id, email, role } returned by getAuthUser(req).
// ---------------------------------------------------------------------------

import { getVisibleEmailsForAccess, ALL_EMAILS_SET } from '../data/members';

/**
 * Return the Set<string> of member emails that `user` is allowed to see.
 *
 * NOTE: `user.role` is the JWT role claim ("admin" | "regional_manager" |
 * "team_lead" | "agent"). If present, we short-circuit for admin.
 * Otherwise we resolve purely via email lookup into TEAM_MEMBERS, which
 * matches what the FE does so server + client stay in lockstep.
 */
export function getVisibleMemberEmails(user) {
  if (!user || !user.email) return new Set();
  if (user.role === 'admin') return ALL_EMAILS_SET;
  return getVisibleEmailsForAccess(user.email);
}

/**
 * True if `user` is an admin / unrestricted caller.
 */
export function isAdmin(user) {
  return user?.role === 'admin';
}

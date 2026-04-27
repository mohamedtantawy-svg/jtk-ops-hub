// ── Shared per-ticket scope check ──────────────────────────────────────────
// Used by every /queue/[ticketId]/* route to enforce "can this user act on
// this ticket". Mirrors the FE's queue-scoping rules so the same answer
// you get when looking at the queue list applies to mutations against
// individual rows.
//
// Returns { allowed, reason } so callers can distinguish:
//   • allowed: true                 → safe to proceed
//   • allowed: false, reason: ...   → 403 with a clear cause string
//
// reason values:
//   'unauthenticated' — no user object on the request
//   'out_of_scope'    — ticket exists in cache but isn't visible to this user
//   'unknown_ticket'  — ticket isn't in the cached queue or shadow DB row;
//                       fail closed (prior behaviour was to default-allow,
//                       which let any authed agent mutate any ticket)
// ───────────────────────────────────────────────────────────────────────────

import { cacheGet } from './server-cache';
import { getVisibleMemberEmails, isAdmin } from './scope-helpers';
import { getVisibleCountries } from './queue-scoping';
import { query } from './db';

const STALE_TTL_MS = 30 * 60_000;

function isZendeskTicket(ticketId) {
  return ticketId.startsWith('ZD-');
}

export async function checkQueueTicketScope(ticketId, user) {
  if (!user) return { allowed: false, reason: 'unauthenticated' };
  if (isAdmin(user) || user.role === 'regional_manager') return { allowed: true };

  const sourceKey = isZendeskTicket(ticketId) ? 'queue_zendesk' : 'queue_jira';
  const combined = cacheGet('queue', STALE_TTL_MS);
  const perSource = cacheGet(sourceKey, STALE_TTL_MS);
  const pools = [];
  if (combined?.items) pools.push(combined.items);
  if (perSource?.items) pools.push(perSource.items);

  let match = null;
  for (const pool of pools) {
    match = pool.find(t => t.id === ticketId);
    if (match) break;
  }

  if (match) {
    const visible = getVisibleMemberEmails(user);
    const email = (match.assigneeEmail || '').toLowerCase();
    if (email && visible.has(email)) return { allowed: true };
    if (!email && user.role === 'team_lead') {
      const cc = (match.country || match.countryCode || '').toUpperCase();
      if (cc && getVisibleCountries(user).has(cc)) return { allowed: true };
    }
    return { allowed: false, reason: 'out_of_scope' };
  }

  // Cold-cache fallback: persistent shadow row in tasks. Same rule as above.
  try {
    const { rows } = await query(
      `SELECT m.email AS assignee_email, t.country_code
         FROM tasks t
         LEFT JOIN members m ON m.id = t.assignee_id
        WHERE t.external_id = $1
        LIMIT 1`,
      [ticketId],
    );
    if (rows.length) {
      const email = (rows[0].assignee_email || '').toLowerCase();
      const cc = (rows[0].country_code || '').toUpperCase();
      const visible = getVisibleMemberEmails(user);
      if (email && visible.has(email)) return { allowed: true };
      if (!email && user.role === 'team_lead' && cc && getVisibleCountries(user).has(cc)) return { allowed: true };
      return { allowed: false, reason: 'out_of_scope' };
    }
  } catch (err) {
    console.warn('[queue-ticket-scope] cold-cache fallback failed:', err.message);
  }
  return { allowed: false, reason: 'unknown_ticket' };
}

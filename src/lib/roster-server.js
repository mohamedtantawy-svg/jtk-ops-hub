// ── Server-side roster hydrator ─────────────────────────────────────────────
// The client hook (useTeamMembers) pulls team_member_overrides and calls
// hydrateRoster() — that fixes BROWSER scoping. But server routes run in a
// separate Node process with their own module copy of src/data/members.js,
// which boots with only the static TEAM_MEMBERS baseline. Without hydrating
// there too, server-side scoping (filterByAssignee, scopeOnboardingRows, etc.)
// ignores every override the user has made on the Team tab.
//
// This module is the bridge: scoped API routes call `await
// ensureRosterHydrated()` before any scoping helper runs. A TTL-gated cache
// (5 seconds) collapses concurrent requests into a single DB query, and a
// singleton in-flight Promise prevents thundering-herd on cold start.
//
// Mutation endpoints (POST / PATCH / DELETE on /api/v1/team-members*) should
// call `invalidateRosterCache()` after a successful write so the next read
// rebuilds from the DB immediately.

import { query } from './db';
import { mergeTeamMembers } from './team-members-merge';
import { hydrateRoster } from '../data/members';

// Fresh for 5 seconds — long enough to collapse a burst of scoped API calls,
// short enough that a Team-tab edit propagates to the next queue fetch.
const TTL_MS = 5_000;

let _lastHydratedAt = 0;
let _inFlight = null;

/**
 * Ensure the server-side roster is hydrated with team_member_overrides.
 *
 * @param {object} opts
 * @param {boolean} [opts.force]  — bypass the TTL cache and refetch now.
 * @returns {Promise<boolean>}    — true if hydration ran, false if the cache
 *                                  was still fresh and nothing happened.
 */
export async function ensureRosterHydrated({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - _lastHydratedAt < TTL_MS) return false;
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    try {
      const { rows } = await query(
        `SELECT email, name, initials, title, access, manager_email, team, region,
                service, country, avatar_url, start_date, is_new, is_deleted,
                on_leave, last_login_at, login_count
           FROM team_member_overrides`
      );
      const merged = mergeTeamMembers(rows);
      hydrateRoster(merged);
      _lastHydratedAt = Date.now();
      return true;
    } catch (err) {
      // DB down? Don't 500 every scoped endpoint — the static baseline is
      // still in place and returning it is better than a cascading failure.
      // Log once per cache window so we notice without spamming logs.
      console.warn('[roster-server] hydration failed, keeping current roster:', err?.message || err);
      // Half-populate the timer so we don't hammer the DB on every miss.
      _lastHydratedAt = Date.now() - TTL_MS / 2;
      return false;
    } finally {
      _inFlight = null;
    }
  })();

  return _inFlight;
}

/** Flush the TTL so the next ensureRosterHydrated() call refetches from DB.
 *  Call after any team_member_overrides mutation. */
export function invalidateRosterCache() {
  _lastHydratedAt = 0;
}

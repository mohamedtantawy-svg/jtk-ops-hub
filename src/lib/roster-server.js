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
import { hydrateOwnerCountries } from '../data/countryOwners';

// Fresh for 5 seconds — long enough to collapse a burst of scoped API calls,
// short enough that a Team-tab edit propagates to the next queue fetch.
const TTL_MS = 5_000;

let _lastHydratedAt = 0;
let _inFlight = null;

// Live country-ownership map. queue-scoping.js reads from this via
// getOwnerCountriesMap() so allocation edits via the Team tab take effect on
// the next queue fetch without a deploy. Populated on every roster
// hydration alongside the member list.
let _ownerCountries = new Map();
let _allCountries = new Set();

function rebuildCountriesMap(rows) {
  const owners = new Map();
  const allCountries = new Set();
  for (const r of rows) {
    const email = (r?.email || '').toLowerCase();
    const cc = (r?.country_code || '').toUpperCase();
    if (!email || !cc) continue;
    if (!owners.has(email)) owners.set(email, new Set());
    owners.get(email).add(cc);
    allCountries.add(cc);
  }
  _ownerCountries = owners;
  _allCountries = allCountries;
}

/**
 * Returns the live Map<email, Set<countryCode>> of country ownership.
 * Reads always reflect the most-recent successful hydration. Empty until
 * `ensureRosterHydrated()` runs at least once.
 */
export function getOwnerCountriesMap() {
  return _ownerCountries;
}

/**
 * Returns the union of every country code currently owned by anyone — the
 * "all countries" baseline used by admin-scope queue lookups.
 */
export function getAllOwnedCountries() {
  return _allCountries;
}

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
      // Run member overrides + country ownership in parallel — they hit
      // different tables and feed different lookups. We track the country
      // query as nullable so a transient DB blip doesn't wipe the
      // previously-hydrated ownership map (passing `[]` to
      // hydrateOwnerCountries would clobber a known-good map with an empty
      // one and break Queue scoping mid-session).
      const [overridesRes, countriesRes, loginsRes] = await Promise.all([
        query(
          `SELECT email, name, initials, title, access, manager_email, team, region,
                  service, country, avatar_url, start_date, is_new, is_deleted,
                  on_leave
             FROM team_member_overrides`,
        ),
        query(
          `SELECT email, country_code FROM team_member_countries`,
        ).catch(err => {
          // Table missing (brand-new env where the migration hasn't run)
          // OR transient DB error. Either way: preserve whatever the map
          // is currently set to and surface a single warn.
          console.warn('[roster-server] team_member_countries query failed:', err?.message);
          return null;
        }),
        // member_logins is the canonical activity store. Pulled separately
        // so we don't hold an outer-join row count up against the overrides
        // count — empty rows here just mean every member shows "Never seen"
        // until the next heartbeat / login.
        query(
          `SELECT email, last_seen_at, last_login_at, login_count FROM member_logins`,
        ).catch(err => {
          console.warn('[roster-server] member_logins query failed:', err?.message);
          return { rows: [] };
        }),
      ]);
      const merged = mergeTeamMembers(overridesRes.rows, loginsRes.rows);
      hydrateRoster(merged);
      if (countriesRes) {
        rebuildCountriesMap(countriesRes.rows);
        // Push the live junction-table rows into countryOwners.js so
        // queue-scoping.js reads the same map every other module sees.
        hydrateOwnerCountries(countriesRes.rows);
      }
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

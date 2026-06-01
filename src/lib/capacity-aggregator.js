// ── Capacity demand aggregator (Phase 1 — 2026-06-01) ─────────────────────
// Backs the Leaders Hub → Capacity → Country Workload table. Pulls live
// rows from every visible Deel source for the caller's current dept and
// groups them by country, producing the per-country counts that mirror
// Kristina Fomina's spreadsheet audit columns (Amend/mo, Resign/mo,
// Term/mo, Onboard/mo, WB/mo, Redlines/mo, Incentive/mo, Immigration/mo).
//
// Phase 1 ships a SNAPSHOT-as-monthly model: the per-country counts are
// the live actionable queue volume right now (= what's waiting to be
// worked). True 30/60-day rolling averages need a daily snapshot table
// + cron — tracked as a Phase 7 follow-up.
//
// Zendesk + Jira buckets stay at 0 in Phase 1 (their per-dept fetchers
// are private to /api/v1/queue and aren't exported yet). Phase 1B will
// extract them into a shared helper. The 'evl' column is reserved for
// the audit's "EVL" category which doesn't have a direct Ops Hub source;
// stays at 0 until a per-dept input maps to it.
//
// Per-dept dispatch:
//   • HRX (deelSources.* = true): default env-var tokens, no overrides.
//   • GIX  (workbench + immigrationTasks): passes DEEL_ADMIN_GIX via
//     adminTokenOverride + teamIds (Phase 13b dispatch).
//   • Payroll / Benefits: empty (no integrations wired yet — correct
//     fail-closed behavior for a fresh dept).
//
// Cache: 15-minute in-process Map keyed by deptId. The capacity sub-tab
// loads once on open; a manual refresh button busts the cache (Phase 1).

import { query } from './db';
import {
  listOnboardingPeople,
  listPausedOnboarding,
  listOffboardingCases,
  listAmendmentRequests,
  listRedlineRequests,
  listIncentivePlans,
  listWorkbenchTasks,
  listImmigrationActions,
} from './deel-api';
import { visibleDeelSourcesFor, resolveWorkbenchConfig } from './dept-integrations';

const CACHE_TTL_MS = 15 * 60 * 1000;
const _cache = new Map(); // deptId -> { ts, value }

// Bucket keys mirror Kristina's audit columns 1:1. `evl` stays at 0 in
// Phase 1; `zd` and `jira` stay at 0 in Phase 1A.
const EMPTY_BUCKET = Object.freeze({
  amend: 0, resign: 0, term: 0, onboard: 0,
  evl: 0, jira: 0, zd: 0,
  wb: 0, redlines: 0, incentive: 0, immig: 0,
});

function getCountry(row) {
  const cc = String(row?.country || row?.countryCode || '').toUpperCase().trim();
  return cc || 'UNKNOWN';
}

function safe(promise, label) {
  return promise.catch(err => {
    console.warn(`[capacity] ${label} fetch failed:`, err?.message);
    return { items: [] };
  });
}

async function fetchAllSources(deptSlug) {
  const visible = visibleDeelSourcesFor(deptSlug);
  const wbCfg = resolveWorkbenchConfig(deptSlug);
  // adminTokenOverride is honored only by listWorkbenchTasks and
  // listImmigrationActions (per Phase 13b). The other listX functions
  // use the env-var DEEL_ADMIN_TOKEN — fine because HRX's deelSources
  // are the only ones that turn those on.
  const wbOpts = wbCfg
    ? { adminTokenOverride: wbCfg.token, teamIds: wbCfg.teamIds, teamFilter: wbCfg.teamFilter }
    : {};
  const immOpts = wbCfg ? { adminTokenOverride: wbCfg.token } : {};

  return Promise.all([
    visible.onboarding       ? safe(listOnboardingPeople({}),    'onboarding')   : Promise.resolve({ items: [] }),
    visible.onboarding       ? safe(listPausedOnboarding(),      'pausedOnb')    : Promise.resolve({ items: [] }),
    visible.offboarding      ? safe(listOffboardingCases(),      'offboarding')  : Promise.resolve({ items: [] }),
    visible.amendments       ? safe(listAmendmentRequests({}),   'amendments')   : Promise.resolve({ items: [] }),
    visible.redlines         ? safe(listRedlineRequests({}),     'redlines')     : Promise.resolve({ items: [] }),
    visible.incentivePlans   ? safe(listIncentivePlans({}),      'incentive')    : Promise.resolve({ items: [] }),
    visible.workbench        ? safe(listWorkbenchTasks(wbOpts),  'workbench')    : Promise.resolve({ items: [] }),
    visible.immigrationTasks ? safe(listImmigrationActions(immOpts), 'immigration') : Promise.resolve({ items: [] }),
  ]);
}

async function loadHcOverrides(deptId) {
  try {
    const { rows } = await query(
      `SELECT country_code, eor_hc FROM capacity_country_hc WHERE org_node_id = $1`,
      [deptId],
    );
    const map = new Map();
    for (const r of rows) {
      map.set(String(r.country_code).toUpperCase(), Number(r.eor_hc) || 0);
    }
    return map;
  } catch (err) {
    console.warn('[capacity] HC override read failed:', err?.message);
    return new Map();
  }
}

async function loadCountryOwners(deptId) {
  // Owners = members in this dept's sub-tree who are assigned to the
  // country via team_member_countries. Mirrors the existing
  // country-ownership pattern used by queue-scoping.
  const owners = new Map(); // country -> emails[]
  try {
    const { rows } = await query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM org_nodes WHERE id = $1 AND is_archived = false
         UNION ALL
         SELECT n.id FROM org_nodes n
           JOIN subtree s ON n.parent_id = s.id
          WHERE n.is_archived = false
       )
       SELECT LOWER(tmc.email) AS email,
              UPPER(tmc.country_code) AS cc
         FROM team_member_countries tmc
         JOIN team_member_overrides tmo
           ON LOWER(tmo.email) = LOWER(tmc.email)
        WHERE tmo.org_node_id IN (SELECT id FROM subtree)
        ORDER BY tmc.country_code, tmc.email`,
      [deptId],
    );
    for (const r of rows) {
      if (!owners.has(r.cc)) owners.set(r.cc, []);
      owners.get(r.cc).push(r.email);
    }
  } catch (err) {
    console.warn('[capacity] owner lookup failed:', err?.message);
  }
  return owners;
}

/**
 * Aggregate the country-workload table for one dept. Returns
 * `{ rows: [...], cachedAt }` where each row carries the per-source
 * counts, the resolved owner emails, and derived totals.
 *
 * Honors a 15-minute in-process cache per dept; pass `{ bustCache: true }`
 * to force a fresh fetch (manual refresh button).
 */
export async function aggregateCountryWorkload({ deptId, deptSlug, bustCache = false }) {
  if (!deptId) return { rows: [], cachedAt: null };
  if (!bustCache) {
    const cached = _cache.get(deptId);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;
  }

  const [onb, paused, offb, amend, redlines, incentive, wb, immig] = await fetchAllSources(deptSlug);
  const byCountry = new Map();
  const bump = (cc, key) => {
    if (!byCountry.has(cc)) byCountry.set(cc, { ...EMPTY_BUCKET });
    byCountry.get(cc)[key] += 1;
  };

  for (const r of (onb.items     || [])) bump(getCountry(r), 'onboard');
  for (const r of (paused.items  || [])) bump(getCountry(r), 'onboard');
  for (const r of (offb.items    || [])) {
    bump(getCountry(r), r?.isResignation ? 'resign' : 'term');
  }
  for (const r of (amend.items   || [])) bump(getCountry(r), 'amend');
  for (const r of (redlines.items|| [])) bump(getCountry(r), 'redlines');
  for (const r of (incentive.items||[])) bump(getCountry(r), 'incentive');
  for (const r of (wb.items      || [])) bump(getCountry(r), 'wb');
  for (const r of (immig.items   || [])) bump(getCountry(r), 'immig');

  const [hcMap, ownerMap] = await Promise.all([
    loadHcOverrides(deptId),
    loadCountryOwners(deptId),
  ]);

  // Always include every country that has either an owner OR demand —
  // owner-only rows show "0 tasks" so the admin can spot countries the
  // team is overstaffed against; demand-only rows show "Unassigned" so
  // they can spot uncovered countries.
  const allCountries = new Set([
    ...byCountry.keys(),
    ...ownerMap.keys(),
    ...hcMap.keys(),
  ]);
  allCountries.delete(''); // defensive

  const rows = Array.from(allCountries).map(country => {
    const counts = byCountry.get(country) || { ...EMPTY_BUCKET };
    const total =
      counts.amend + counts.resign + counts.term + counts.onboard +
      counts.evl + counts.jira + counts.zd +
      counts.wb + counts.redlines + counts.incentive + counts.immig;
    const ownerEmails = ownerMap.get(country) || [];
    return {
      country,
      eorHc: hcMap.get(country) || 0,
      amend: counts.amend,
      resign: counts.resign,
      term: counts.term,
      onboard: counts.onboard,
      evl: counts.evl,
      jira: counts.jira,
      zd: counts.zd,
      wb: counts.wb,
      redlines: counts.redlines,
      incentive: counts.incentive,
      immig: counts.immig,
      totalTasks: total,
      numOwners: ownerEmails.length,
      tasksPerOwner: ownerEmails.length > 0 ? +(total / ownerEmails.length).toFixed(1) : 0,
      ownerEmails,
    };
  });
  // Default sort: total tasks desc, then country asc.
  rows.sort((a, b) => (b.totalTasks - a.totalTasks) || a.country.localeCompare(b.country));

  const value = { rows, cachedAt: new Date().toISOString() };
  _cache.set(deptId, { ts: Date.now(), value });
  return value;
}

export function clearCapacityAggregatorCache(deptId) {
  if (deptId) _cache.delete(deptId);
  else _cache.clear();
}

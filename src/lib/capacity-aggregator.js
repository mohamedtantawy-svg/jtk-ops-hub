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

// Settings shape mirrors the per-dept defaults synthesized by the route's
// loadSettings — keeping a fallback here lets the member-load function
// run safely even if the caller forgets to pass settings.
const FALLBACK_SETTINGS = Object.freeze({
  workingDays: 22,
  minutesPerTask: 15,
  minutesPerCall: 15,
  baselineCallHrs: 2.47,
  thresholdOk: 5.5,
  thresholdModerate: 7.0,
  thresholdElevated: 8.0,
});

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

// ── Phase 2: per-member load roll-up ──────────────────────────────────────
// Takes the per-country workload + the dept's settings + manual member-
// call overrides, and produces one row per member shaped exactly like
// Kristina's sheet 2 (HRX Capacity Current):
//   email / name / title / role / teamLeadEmail / countries / hc /
//   numCountries / tasksPerMonth / callsPerMonth / tasksPerDay /
//   taskHrsPerDay / callHrsPerDay / totalWlPerMonth / totalHrsPerDay /
//   signal ('ok' | 'moderate' | 'elevated' | 'high')
//
// Tasks are SHARED across co-owners — a country with 3 owners contributes
// `country.totalTasks / 3` to each owner's roll-up. This matches the
// audit (Alexandra Apsychou's 450.2 vs Greece+Cyprus+Portugal individual
// totals confirmed the formula).
//
// Members included: every non-archived member in the dept's sub-tree.
// Team Lead grouping: walks `manager_email` chain to the first ancestor
// whose `access` IN ('team_lead','regional_manager','manager','admin').
// Returns the lead's email + name so the FE doesn't need a second JOIN.

function bandSignal(totalHrsPerDay, settings) {
  const t = settings || FALLBACK_SETTINGS;
  if (totalHrsPerDay >= (t.thresholdElevated ?? 8.0)) return 'high';
  if (totalHrsPerDay >= (t.thresholdModerate ?? 7.0)) return 'elevated';
  if (totalHrsPerDay >= (t.thresholdOk        ?? 5.5)) return 'moderate';
  return 'ok';
}

async function loadDeptMembers(deptId) {
  // Members in the dept's sub-tree, with the bits we need for the row.
  // Joins org_nodes via the recursive CTE pattern used elsewhere; excludes
  // archived nodes + soft-deleted members.
  const { rows } = await query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM org_nodes WHERE id = $1 AND is_archived = false
       UNION ALL
       SELECT n.id FROM org_nodes n
         JOIN subtree s ON n.parent_id = s.id
        WHERE n.is_archived = false
     )
     SELECT LOWER(tmo.email) AS email,
            tmo.name,
            COALESCE(tmo.title, '') AS title,
            COALESCE(tmo.access, 'agent') AS access,
            LOWER(COALESCE(tmo.manager_email, '')) AS manager_email,
            COALESCE(tmo.on_leave, false) AS on_leave
       FROM team_member_overrides tmo
      WHERE tmo.org_node_id IN (SELECT id FROM subtree)
        AND tmo.is_deleted = false
      ORDER BY tmo.name`,
    [deptId],
  );
  return rows;
}

async function loadMemberCountries(deptId) {
  // email -> [country_code] for every dept member, mirroring Phase 1's
  // dept-scoped subtree filter.
  const out = new Map();
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
        ORDER BY tmc.country_code`,
      [deptId],
    );
    for (const r of rows) {
      if (!out.has(r.email)) out.set(r.email, []);
      out.get(r.email).push(r.cc);
    }
  } catch (err) {
    console.warn('[capacity] member-countries load failed:', err?.message);
  }
  return out;
}

async function loadMemberCalls(deptId) {
  const out = new Map();
  try {
    const { rows } = await query(
      `SELECT LOWER(email) AS email, calls_per_mo
         FROM capacity_member_calls
        WHERE org_node_id = $1`,
      [deptId],
    );
    for (const r of rows) out.set(r.email, Number(r.calls_per_mo) || 0);
  } catch (err) {
    console.warn('[capacity] member-calls override load failed:', err?.message);
  }
  return out;
}

/**
 * Build the per-member load roll-up. Returns
 * `{ members: [...], leads: { email: { name, role, count } } }` where
 * `members` is one row per dept member sorted by teamLead then by
 * totalHrsPerDay desc, and `leads` is a lookup of every Team Lead that
 * appears as a grouping anchor so the FE can render section headers
 * without re-walking the chain.
 */
export async function aggregateMemberLoad({ deptId, countryWorkload = [], settings }) {
  if (!deptId) return { members: [], leads: {} };
  const t = { ...FALLBACK_SETTINGS, ...(settings || {}) };

  const [members, countriesByEmail, callsByEmail] = await Promise.all([
    loadDeptMembers(deptId),
    loadMemberCountries(deptId),
    loadMemberCalls(deptId),
  ]);

  const countryLookup = new Map();
  for (const c of countryWorkload) countryLookup.set(String(c.country).toUpperCase(), c);

  // Build a quick (email -> member) map so we can walk manager chain
  // without re-querying.
  const memberByEmail = new Map();
  for (const m of members) memberByEmail.set(m.email, m);

  // Resolve the first manager-tier ancestor for a given member email.
  // Capped at 6 hops to defend against malformed cycles (mirrors
  // teamLeadEmailFor in src/lib/hr-hub-helpers.js).
  function findLead(startEmail) {
    let cursor = startEmail;
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      if (!cursor || seen.has(cursor)) break;
      seen.add(cursor);
      const m = memberByEmail.get(cursor);
      if (!m) return '';
      if (m.access === 'team_lead' || m.access === 'regional_manager'
          || m.access === 'manager' || m.access === 'admin') {
        return cursor;
      }
      cursor = m.manager_email || '';
    }
    return '';
  }

  const rows = [];
  for (const m of members) {
    // Skip Team Leads / RMs / Directors as row entries — the audit
    // surfaces them as section headers only. They still appear in the
    // `leads` lookup below for grouping. (If a TL also handles tasks
    // directly, Phase 4 will add an opt-in toggle to include them.)
    if (m.access !== 'agent') continue;

    const countries = countriesByEmail.get(m.email) || [];
    let tasksPerMonth = 0;
    let hc = 0;
    for (const cc of countries) {
      const c = countryLookup.get(cc);
      if (!c) continue;
      const share = c.numOwners > 0 ? c.totalTasks / c.numOwners : c.totalTasks;
      tasksPerMonth += share;
      hc += Number(c.eorHc) || 0;
    }
    const callsPerMonth = callsByEmail.get(m.email) || 0;

    const workingDays = Math.max(1, t.workingDays || 22);
    const tasksPerDay      = tasksPerMonth / workingDays;
    const taskHrsPerDay    = (tasksPerDay * (t.minutesPerTask || 15)) / 60;
    const callHrsPerDay    = (t.baselineCallHrs ?? 2.47) + ((callsPerMonth * (t.minutesPerCall || 15)) / 60) / workingDays;
    const totalWlPerMonth  = tasksPerMonth + callsPerMonth;
    const totalHrsPerDay   = taskHrsPerDay + callHrsPerDay;

    const leadEmail = findLead(m.manager_email);

    rows.push({
      email: m.email,
      name: m.name,
      title: m.title,
      role: m.access,
      onLeave: m.on_leave === true,
      teamLeadEmail: leadEmail,
      countries,
      numCountries: countries.length,
      hc,
      tasksPerMonth: +tasksPerMonth.toFixed(1),
      callsPerMonth: +callsPerMonth.toFixed(1),
      tasksPerDay:   +tasksPerDay.toFixed(1),
      taskHrsPerDay: +taskHrsPerDay.toFixed(2),
      callHrsPerDay: +callHrsPerDay.toFixed(2),
      totalWlPerMonth: +totalWlPerMonth.toFixed(1),
      totalHrsPerDay:  +totalHrsPerDay.toFixed(2),
      signal: bandSignal(totalHrsPerDay, t),
    });
  }

  // Sort: by Team Lead name (alphabetical), then by total hrs/day desc
  // within each lead's group. Unlinked rows (no lead) bucket to the end.
  const leadName = (email) => memberByEmail.get(email)?.name || 'Unassigned';
  rows.sort((a, b) => {
    const an = leadName(a.teamLeadEmail);
    const bn = leadName(b.teamLeadEmail);
    if (an !== bn) {
      if (a.teamLeadEmail && !b.teamLeadEmail) return -1;
      if (!a.teamLeadEmail && b.teamLeadEmail) return 1;
      return an.localeCompare(bn);
    }
    return (b.totalHrsPerDay || 0) - (a.totalHrsPerDay || 0);
  });

  // Build the leads lookup so the FE can render section headers with
  // the lead's name + count without re-walking.
  const leads = {};
  for (const r of rows) {
    const k = r.teamLeadEmail || '';
    if (!leads[k]) {
      const m = memberByEmail.get(k);
      leads[k] = {
        email: k,
        name: m?.name || (k ? k : 'Unassigned'),
        role: m?.access || 'unassigned',
        memberCount: 0,
      };
    }
    leads[k].memberCount += 1;
  }

  return { members: rows, leads };
}

// ── Phase 3: per-Team-Lead summary roll-up ────────────────────────────────
// One row per Team Lead. Mirrors Kristina's sheet 4 ("Team Summary"):
//   teamLeadEmail / teamLeadName / teamLeadRole / memberCount /
//   countriesCovered (unique, sorted) / numCountriesCovered /
//   totalHc / totalTasksPerMonth / totalCallsPerMonth / totalWlPerMonth /
//   avgWlPerPersonPerMonth / avgTaskHrsPerDay / avgCallHrsPerDay /
//   avgTotalHrsPerDay / signal (banded on avgTotalHrsPerDay)
//
// Derives entirely from `aggregateMemberLoad`'s output so the math is
// guaranteed to match the per-member view (a stat the Team Summary
// drift would be the easiest thing for a manager to spot otherwise).

export function aggregateTeamSummary({ members = [], leads = {}, settings }) {
  if (!Array.isArray(members) || members.length === 0) return { teams: [] };
  const t = { ...FALLBACK_SETTINGS, ...(settings || {}) };

  // Bucket members by their teamLeadEmail. Members with no lead bucket
  // under the empty string key — surfaced as "Unassigned" in the FE.
  const byLead = new Map();
  for (const m of members) {
    const k = m.teamLeadEmail || '';
    if (!byLead.has(k)) byLead.set(k, []);
    byLead.get(k).push(m);
  }

  const teams = [];
  for (const [leadEmail, group] of byLead.entries()) {
    const lead = leads[leadEmail] || { email: leadEmail, name: leadEmail || 'Unassigned', role: 'unassigned' };
    const countriesSet = new Set();
    let totalHc = 0, totalTasks = 0, totalCalls = 0, totalWl = 0;
    let sumTaskHrs = 0, sumCallHrs = 0, sumTotalHrs = 0;
    for (const m of group) {
      for (const cc of (m.countries || [])) countriesSet.add(cc);
      totalHc      += Number(m.hc) || 0;
      totalTasks   += Number(m.tasksPerMonth) || 0;
      totalCalls   += Number(m.callsPerMonth) || 0;
      totalWl      += Number(m.totalWlPerMonth) || 0;
      sumTaskHrs   += Number(m.taskHrsPerDay) || 0;
      sumCallHrs   += Number(m.callHrsPerDay) || 0;
      sumTotalHrs  += Number(m.totalHrsPerDay) || 0;
    }
    const n = group.length;
    const avgWl       = n > 0 ? totalWl / n      : 0;
    const avgTaskHrs  = n > 0 ? sumTaskHrs / n   : 0;
    const avgCallHrs  = n > 0 ? sumCallHrs / n   : 0;
    const avgTotalHrs = n > 0 ? sumTotalHrs / n  : 0;
    const countriesCovered = Array.from(countriesSet).sort();
    teams.push({
      teamLeadEmail: leadEmail,
      teamLeadName: lead.name,
      teamLeadRole: lead.role,
      memberCount: n,
      countriesCovered,
      numCountriesCovered: countriesCovered.length,
      totalHc,
      totalTasksPerMonth: +totalTasks.toFixed(1),
      totalCallsPerMonth: +totalCalls.toFixed(1),
      totalWlPerMonth:    +totalWl.toFixed(1),
      avgWlPerPersonPerMonth: +avgWl.toFixed(1),
      avgTaskHrsPerDay: +avgTaskHrs.toFixed(2),
      avgCallHrsPerDay: +avgCallHrs.toFixed(2),
      avgTotalHrsPerDay: +avgTotalHrs.toFixed(2),
      signal: bandSignal(avgTotalHrs, t),
    });
  }
  // Sort by member count desc (largest team first), then by lead name.
  teams.sort((a, b) => (b.memberCount - a.memberCount) || a.teamLeadName.localeCompare(b.teamLeadName));
  return { teams };
}

// ── GET /api/v1/queue ────────────────────────────────────────────────────────
// Unified queue: pulls active tickets from Zendesk + Jira, normalizes to a
// single shape, and returns a merged list. This is the single source of truth.
//
// Zendesk: HR Experience group, statuses new/open/pending/hold (paginated)
// Jira:    Issues assigned to registered app emails (not completed)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { searchTickets, showManyUsers, isZendeskConfigured } from '../../../../src/lib/zendesk-api';
import { loadSlaRowsForTicketIds, warmSlaCacheForTicketIds } from '../../../../src/lib/zendesk-sla-sync';
import { searchIssues, isJiraConfigured, resolveHrxOwnerFields, emailsFromJiraFieldValue } from '../../../../src/lib/jira-api';
import { getCurrentDeptSlugAndId } from '../../../../src/lib/dept-scope';
import { SLUGS, resolveZendeskConfig, resolveJiraConfig } from '../../../../src/lib/dept-integrations';

// Jira custom fields (by display-name substring) that, together with the
// built-in `assignee` and `reporter`, govern whether a ticket belongs to our
// queue. Per Pilar's 2026-04-22 clarification: the scope is ASSIGNEE +
// REPORTER + HRX RESPONSIBLE only — the previous broader list (Country
// Owner / Task Owner / Process Owner / Team Responsible) is explicitly
// out of scope. Keeping a single entry also prevents the JQL from growing
// past the URL length that caused 414 errors on the Jira API.
const HRX_OWNER_FIELD_NAMES = [
  'hrx responsible',
];

// Project allow-list — the queue surfaces ONLY tickets in these Jira
// projects. Without this filter, HRX team members assigned/reporting on
// (e.g.) the EOR Compliance project (key `EC`) drag those tickets into the
// ops queue even though they're owned by another team. The role-based JQL
// alone can't exclude them, so we narrow the project up front.
const JIRA_PROJECT_KEYS = ['COHD', 'OSHD'];
import { ADMIN_EMAILS_LIST } from '../../../../src/data/adminEmails';
import { cacheGet, cacheSet } from '../../../../src/lib/server-cache';
import { filterByAssignee } from '../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../src/lib/roster-server';
import { resolveCustomFieldIds, extractCustomFieldValues } from '../../../../src/lib/zendesk-fields';

// ── Server-side scope filter ─────────────────────────────────────────────────
// Zendesk and Jira are assignee-based queues — delegates to the shared scoping
// helper (src/lib/queue-scoping.js) so FE + BE apply byte-identical rules.
//
//   admin            → all
//   regional_manager → own + full subtree's assignees + unassigned in subtree countries
//   team_lead        → own + direct reports' assignees + unassigned in team countries
//   agent            → only items assigned to self
function scopeQueueItems(items, user) {
  return filterByAssignee(items || [], user);
}

// ── Config (overridable via env vars) ────────────────────────────────────────
const ZD_GROUP_NAME = process.env.ZENDESK_HR_GROUP || 'HR Experience';
const JIRA_BASE     = process.env.JIRA_BASE_URL    || '';
const ZD_SUBDOMAIN  = process.env.ZENDESK_SUBDOMAIN || '';

// ── Persistent cache (survives restarts via filesystem) ─────────────────────
const CACHE_KEY = 'queue';
const CACHE_TTL = 3 * 60_000;       // fresh for 3 minutes
const STALE_TTL = 30 * 60_000;      // serve stale up to 30 minutes while refreshing

// ── Runtime SLA settings (Team-tab editable) ────────────────────────────────
// Reads app_settings.queue_sla_thresholds — same row the
// /api/v1/settings/queue-sla route writes. Cached 30s in-process so the
// per-request hop is one SELECT at most. Defaults to the 2026-05-01 spec
// values when no row exists yet (ZD 24h active / 48h paused, Jira 48h).
// All values are BUSINESS-DAY minutes.
const SLA_DEFAULTS = {
  zendeskActiveMins: 24 * 60,
  zendeskPausedMins: 48 * 60,
  jiraMins:          48 * 60,
};
let _slaCache = { value: null, ts: 0 };
async function getSlaOverrides() {
  const now = Date.now();
  if (_slaCache.value && (now - _slaCache.ts) < 30_000) return _slaCache.value;
  let result = { ...SLA_DEFAULTS };
  if (process.env.DATABASE_URL) {
    try {
      const { query } = await import('../../../../src/lib/db');
      const { rows } = await query(
        "SELECT value FROM app_settings WHERE key = 'queue_sla_thresholds'"
      );
      const v = rows[0]?.value;
      if (v) {
        if (Number.isFinite(v.zendesk?.activeMins) && v.zendesk.activeMins > 0) result.zendeskActiveMins = v.zendesk.activeMins;
        if (Number.isFinite(v.zendesk?.pausedMins) && v.zendesk.pausedMins > 0) result.zendeskPausedMins = v.zendesk.pausedMins;
        if (Number.isFinite(v.jira?.activeMins) && v.jira.activeMins > 0) result.jiraMins = v.jira.activeMins;
      }
    } catch (err) {
      console.warn('[queue] SLA settings read failed (using defaults):', err.message);
    }
  }
  _slaCache = { value: result, ts: now };
  return result;
}

// ── Zendesk status → app status ──────────────────────────────────────────────
const ZD_STATUS_MAP = {
  new:      'new',
  open:     'in_progress',
  pending:  'waiting',
  hold:     'waiting',
  solved:   'resolved',
  closed:   'resolved',
};

// ── Zendesk priority → app priority ──────────────────────────────────────────
const ZD_PRIORITY_MAP = {
  urgent: 'critical',
  high:   'high',
  normal: 'medium',
  low:    'low',
};

// ── Jira status → app status (case-insensitive lookup) ───────────────────────
const JIRA_STATUS_MAP = {
  // New / To Do
  'to do':               'new',
  'open':                'new',
  'backlog':             'new',
  'new':                 'new',
  // In Progress (active work)
  'in progress':         'in_progress',
  'in review':           'in_progress',
  'in development':      'in_progress',
  'code review':         'in_progress',
  'under review':        'in_progress',
  'hrx review':          'in_progress',
  'prm review':          'in_progress',
  'eor signing':         'in_progress',
  // Waiting (blocked on external party)
  'blocked':             'waiting',
  'waiting for support': 'waiting',
  'on hold':             'waiting',
  'pending':             'waiting',
  'client approval':     'waiting',
  'pending wet ink':     'waiting',
  'pending end date':    'waiting',
  'pending another team':'waiting',
  // Resolved / Done
  'done':                'resolved',
  'closed':              'resolved',
  'resolved':            'resolved',
  'solved':              'resolved',
  'completed':           'resolved',
  'cancelled':           'resolved',
  'rejected':            'resolved',
};

// ── Jira priority → app priority ─────────────────────────────────────────────
const JIRA_PRIORITY_MAP = {
  highest:  'critical',
  blocker:  'critical',
  critical: 'critical',
  high:     'high',
  medium:   'medium',
  low:      'low',
  lowest:   'low',
};

// ── Country code detection from tags, subject, or requester email ────────────
const COUNTRY_KEYWORDS = {
  'united kingdom': 'UK', 'uk': 'UK', 'england': 'UK', 'britain': 'UK',
  'germany': 'DE', 'german': 'DE', 'deutschland': 'DE',
  'united states': 'US', 'usa': 'US', 'us': 'US', 'america': 'US',
  'france': 'FR', 'french': 'FR',
  'netherlands': 'NL', 'dutch': 'NL', 'holland': 'NL',
  'singapore': 'SG',
  'brazil': 'BR', 'brasil': 'BR',
  'australia': 'AU', 'australian': 'AU',
  'uae': 'AE', 'emirates': 'AE', 'dubai': 'AE',
  'canada': 'CA', 'canadian': 'CA',
  'japan': 'JP', 'japanese': 'JP',
  'india': 'IN', 'indian': 'IN',
  'mexico': 'MX', 'mexican': 'MX',
  'korea': 'KR', 'korean': 'KR', 'south korea': 'KR',
  'spain': 'ES', 'spanish': 'ES',
  'italy': 'IT', 'italian': 'IT',
  'poland': 'PL', 'polish': 'PL',
  'south africa': 'ZA',
  'nigeria': 'NG', 'nigerian': 'NG',
  'philippines': 'PH', 'filipino': 'PH',
  'indonesia': 'ID', 'indonesian': 'ID',
  'thailand': 'TH', 'thai': 'TH',
  'colombia': 'CO', 'colombian': 'CO',
  'argentina': 'AR', 'argentine': 'AR',
  'chile': 'CL', 'chilean': 'CL',
  'peru': 'PE', 'peruvian': 'PE',
  'portugal': 'PT', 'portuguese': 'PT',
  'romania': 'RO', 'romanian': 'RO',
  'israel': 'IL', 'israeli': 'IL',
  'turkey': 'TR', 'turkish': 'TR',
  'egypt': 'EG', 'egyptian': 'EG',
  'kenya': 'KE', 'kenyan': 'KE',
  'ghana': 'GH', 'ghanaian': 'GH',
  'pakistan': 'PK', 'pakistani': 'PK',
  'sweden': 'SE', 'swedish': 'SE',
  'norway': 'NO', 'norwegian': 'NO',
  'denmark': 'DK', 'danish': 'DK',
  'finland': 'FI', 'finnish': 'FI',
  'ireland': 'IE', 'irish': 'IE',
  'austria': 'AT', 'austrian': 'AT',
  'switzerland': 'CH', 'swiss': 'CH',
  'belgium': 'BE', 'belgian': 'BE',
  'czech': 'CZ', 'czechia': 'CZ',
  'hungary': 'HU', 'hungarian': 'HU',
  'greece': 'GR', 'greek': 'GR',
  'vietnam': 'VN', 'vietnamese': 'VN',
  'malaysia': 'MY', 'malaysian': 'MY',
  'taiwan': 'TW', 'taiwanese': 'TW',
  'hong kong': 'HK',
  'china': 'CN', 'chinese': 'CN',
  'saudi': 'SA', 'saudi arabia': 'SA',
};

function detectCountry(subject, tags = []) {
  // Check tags first (most reliable)
  for (const tag of tags) {
    const t = tag.toLowerCase().trim();
    // Direct ISO code match (2 letters)
    if (t.length === 2 && Object.values(COUNTRY_KEYWORDS).includes(t.toUpperCase())) return t.toUpperCase();
    if (COUNTRY_KEYWORDS[t]) return COUNTRY_KEYWORDS[t];
  }
  // Check subject line
  const subLower = (subject || '').toLowerCase();
  // Match longer keywords first to avoid false positives
  const sorted = Object.entries(COUNTRY_KEYWORDS).sort((a, b) => b[0].length - a[0].length);
  for (const [keyword, code] of sorted) {
    // Use word boundary matching for short keywords
    if (keyword.length <= 2) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(subLower)) return code;
    } else if (subLower.includes(keyword)) {
      return code;
    }
  }
  return '';
}

// ── Tag / label → function type mapping ──────────────────────────────────────
const TYPE_KEYWORDS = {
  onboarding:    'Onboarding',
  offboarding:   'Offboarding',
  termination:   'Offboarding',
  resignation:   'Offboarding',
  benefits:      'Benefits',
  leave:         'Leave Request',
  pto:           'Leave Request',
  'time off':    'Leave Request',
  'time-off':    'Leave Request',
  document:      'Document Request',
  payroll:       'Payment Issue',
  payment:       'Payment Issue',
  salary:        'Payment Issue',
  payslip:       'Payment Issue',
  immigration:   'Immigration',
  visa:          'Immigration',
  'work permit': 'Immigration',
  access:        'Access Issue',
  login:         'Access Issue',
  password:      'Access Issue',
  policy:        'Policy Query',
  expense:       'Expenses',
  reimbursement: 'Expenses',
  schedule:      'Scheduling',
  calendar:      'Scheduling',
  compensation:  'Compensation',
  promotion:     'Promotion',
  recruitment:   'Recruitment',
  hiring:        'Recruitment',
  record:        'Record Update',
  'name change': 'Record Update',
  equipment:     'Equipment',
  laptop:        'Equipment',
  hardware:      'Equipment',
  amendment:     'Amendment',
  contract:      'Amendment',
  compliance:    'Compliance',
  training:      'Compliance',
  gdpr:          'Compliance',
};

function detectType(subject, tags = [], labels = []) {
  const allTags = [...tags, ...labels].map(t => t.toLowerCase());
  for (const tag of allTags) {
    for (const [keyword, type] of Object.entries(TYPE_KEYWORDS)) {
      if (tag.includes(keyword)) return type;
    }
  }
  const subjectLower = (subject || '').toLowerCase();
  for (const [keyword, type] of Object.entries(TYPE_KEYWORDS)) {
    if (subjectLower.includes(keyword)) return type;
  }
  return 'Policy Query';
}

// ── Extract plain text from Jira ADF ─────────────────────────────────────────
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) return node.content.map(adfToText).join('');
  return '';
}

// ── Paginated Zendesk search helper ──────────────────────────────────────────
// Pulls active tickets via `/search.json`. We do NOT request the
// `metric_sets` sideload here — Zendesk's Search API silently ignores
// unsupported includes (metric_sets is sideloadable on /tickets.json
// and /tickets/show_many.json but not on /search). The 2026-05-11 log
// audit caught the consequence: every single fetch was logging
// "NNNN/NNNN tickets missing metric_set sideload — fallback applied"
// because the response never carried any metric_sets. The defensive
// fallback in fetchZendeskQueue's normalize step (anchor on
// updated_at when metric_set is absent) was firing for 100% of rows
// and the row-level FRT/NRT logic was effectively dead code.
//
// The canonical SLA anchor today is the policy_metrics cache built by
// `zendesk-sla-sync.js` (a background cron, persisted in
// zendesk_sla_cache, joined per-row in fetchZendeskQueue via
// `loadSlaRowsForTicketIds`). That cache carries Zendesk's authoritative
// breach state + active stage and is the source of truth for the SLA
// pill on every ticket.
async function paginatedZendeskSearch(query, { maxPages = 10, perPage = 100 } = {}, fetchOpts = {}) {
  // Phase 13c (2026-05-21): fetchOpts carries per-dept auth overrides
  // (tokenOverride/subdomainOverride/emailOverride) for non-HRX queue
  // reads. HRX path leaves fetchOpts empty and behaviour is byte-identical
  // to pre-13c.
  const allResults = [];
  let page = 1;
  // `truncated` flips to true when we exited the loop because of the maxPages
  // safety cap AND the last page came back full (meaning Zendesk had more to
  // give). Surfacing this lets the FE warn users like "Sarah Suge (2026-05-11
  // feedback): all tickets are not fully displayed when scrolling" — without
  // a hint they wouldn't know the listing was capped vs. the team genuinely
  // having no further tickets. Zendesk Search caps total hits at 1000 per
  // query, so a truncated result usually means the query needs narrowing
  // (date range, status, assignee) rather than more pagination.
  let truncated = false;
  // The total Zendesk reports for this query — useful when truncated so the
  // banner can say "showing N of M". Zendesk returns this on every page.
  let serverTotal = null;

  while (page <= maxPages) {
    const res = await searchTickets(query, {
      per_page: perPage,
      page,
      sort_by: 'updated_at',
      sort_order: 'desc',
    }, fetchOpts);
    const results = res?.results || [];
    if (typeof res?.count === 'number') serverTotal = res.count;
    allResults.push(...results);

    // Stop if we got fewer than perPage (last page) or no next_page
    if (results.length < perPage || !res?.next_page) break;
    page++;
    // If we just consumed the final allowed page and the next_page is still
    // populated, Zendesk has more to give — mark the truncation so callers
    // can surface a banner.
    if (page > maxPages && res?.next_page) {
      truncated = true;
    }
  }

  return { results: allResults, truncated, serverTotal };
}

// Zendesk Search's documented hard cap is 1000 hits per query — even
// with unlimited pages, results beyond the 1000th are dropped. When a
// status query exceeds that we silently lost the older tail, and the
// FE rendered a "Some tickets may be hidden" banner. Mohamed 2026-05-18
// reported the banner firing with 2171 / 4053 — ~1882 tickets missing.
//
// Fix: when the unbucketed query trips the cap, fan out by `created`
// date range. Zendesk's relative-time syntax (`created<7days`,
// `created>30days`) splits the result set into disjoint windows, each
// well under the 1000-hit cap unless one calendar bucket is genuinely
// huge. We dedup by ticket id at merge time as a belt-and-braces guard
// against window-edge overlap.
//
// Sequential bucket fetch keeps peak memory bounded (mirrors the
// status-by-status fetch in fetchZendeskQueue). Only fires when the
// unbucketed first attempt is truncated, so the average case still
// costs one query per status.
const ZENDESK_DATE_BUCKETS = [
  // (older-than, newer-than) — both optional. Order is most-recent first
  // so the fast-path "recent tickets" bucket lands rows the FE renders
  // at the top of the table sooner.
  { older: null,       newer: '7days'   }, // last 7 days
  { older: '7days',    newer: '30days'  }, // 7-30 days ago
  { older: '30days',   newer: '180days' }, // 30-180 days ago
  { older: '180days',  newer: '730days' }, // 180 days - 2 years ago
  { older: '730days',  newer: null      }, // older than 2 years
];

async function paginatedZendeskSearchAllTime(baseQuery, { maxPages = 10, perPage = 100 } = {}, fetchOpts = {}) {
  // Phase 13c (2026-05-21): fetchOpts forwarded to every inner search.
  // Fast path: try one unbucketed query. Most statuses (incl. solved
  // updated<24h) fit comfortably under 1000. No splitting cost when not
  // needed.
  const first = await paginatedZendeskSearch(baseQuery, { maxPages, perPage }, fetchOpts);
  if (!first.truncated) return first;

  console.log(`[queue] Zendesk query "${baseQuery}" truncated at 1000-hit cap — splitting into date buckets`);
  const allResults = [];
  const seenIds = new Set();
  let stillTruncated = false;
  // Anchor the user-facing "of X" hint on the unbucketed first probe.
  // Summing each bucket's `res.count` produced bogus inflated totals
  // (verified 2026-05-19: solved-24h probe count = 2156, but the
  // bucket-sum returned 2794 because Zendesk's `count` field is
  // documented as approximate, and one bucket query returned 2156
  // again as its own approximation). The first probe is a single
  // approximation; bucketSum is a sum of approximations and amplifies
  // the slop. We still iterate every bucket to retrieve rows, but the
  // ground-truth count comes from the unbucketed call.
  const firstProbeServerTotal = (typeof first.serverTotal === 'number') ? first.serverTotal : null;

  for (const b of ZENDESK_DATE_BUCKETS) {
    // Compose date range. `created<Xdays` = newer than X days ago,
    // `created>Xdays` = older than X days ago. Combined they form a
    // disjoint window.
    const dateParts = [];
    if (b.newer) dateParts.push(`created<${b.newer}`);
    if (b.older) dateParts.push(`created>${b.older}`);
    const subQuery = `${baseQuery} ${dateParts.join(' ')}`.trim();
    const { results, truncated } = await paginatedZendeskSearch(subQuery, { maxPages, perPage }, fetchOpts);
    for (const t of results) {
      if (t?.id == null || seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      allResults.push(t);
    }
    if (truncated) stillTruncated = true;
  }

  // Honest truncation signal: only flag truncated when retrieved set
  // is meaningfully smaller than what Zendesk says exists. Within a
  // generous 5% tolerance for approximation noise on the count field.
  const honestTruncated = stillTruncated || (
    firstProbeServerTotal !== null
    && allResults.length > 0
    && allResults.length < firstProbeServerTotal * 0.95
  );

  console.log(`[queue] Zendesk bucket-split of "${baseQuery}" recovered ${allResults.length} tickets (${honestTruncated ? 'truncated — refine filter' : 'fully covered'}, upstream estimate=${firstProbeServerTotal})`);
  return {
    results: allResults,
    truncated: honestTruncated,
    serverTotal: firstProbeServerTotal,
  };
}

// ── Batch user lookup with pagination (handles >100 users) ───────────────────
async function batchFetchUsers(userIds, fetchOpts = {}) {
  // Phase 13c: fetchOpts forwards per-dept auth overrides so a GIX query
  // resolves users from GIX's Zendesk instance, not HRX's.
  const userMap = {};
  const idArray = [...userIds];

  // Process in batches of 100
  for (let i = 0; i < idArray.length; i += 100) {
    const batch = idArray.slice(i, i + 100);
    try {
      const res = await showManyUsers(batch, fetchOpts);
      for (const u of (res?.users || [])) {
        userMap[u.id] = { name: u.name, email: u.email };
      }
    } catch (err) {
      console.warn(`[queue] Zendesk user batch ${i}-${i + batch.length} failed:`, err.message);
    }
  }

  return userMap;
}

// ── Diff-based "recently solved" tracking ──────────────────────────────────
// 2026-05-19 — replaces the expensive `status:solved updated<24hours` Zendesk
// fetch (which fan-out + maxPages combined could exceed the FE's 90s timeout
// and return 503). Insight from Mohamed: a ticket that was in our actionable
// set last sync and isn't this sync has either been solved, reassigned, or
// closed — for the queue's "recently resolved" surface, treating it as solved
// is right ~always. We snapshot the raw Zendesk rows on every successful
// fetch, diff against the next sync, and stamp dropouts as solved with the
// sync timestamp. 24h aging keeps the cache bounded.
//
// 2026-05-21 — backing store added (`zd_recently_solved` Postgres table) so
// the cache survives pod restarts. Previously it was per-pod only; every
// deploy wiped the Map and the Briefing "Resolved" KPI plummeted (Abe + Mohamed
// 2026-05-21). The snapshot itself is still pod-local — after a restart the
// first sync can't detect dropouts that happened DURING the deploy gap, but
// the persisted recently-solved entries are restored on hydrate so the 24h
// window of historical resolutions is preserved end-to-end.
const _zdLastActionableSnapshot = new Map(); // id → raw Zendesk row (pod-local)
const _zdRecentlySolvedCache    = new Map(); // id → { row, solvedAt (ms) } (persisted)
const ZD_RECENTLY_SOLVED_TTL_MS = 24 * 60 * 60 * 1000;

// Hydrate-on-first-call gate. Set to a Promise the first time hydration
// starts so concurrent /queue requests during cold start all await the SAME
// hydration round-trip instead of racing duplicate SELECTs.
let _zdRecentlySolvedHydrate = null;

async function _hydrateRecentlySolvedFromDb() {
  if (_zdRecentlySolvedHydrate) return _zdRecentlySolvedHydrate;
  _zdRecentlySolvedHydrate = (async () => {
    try {
      const { query } = await import('../../../../src/lib/db');
      // Age out stale rows at hydrate time — cheap one-shot cleanup that
      // shrinks the SELECT and keeps the in-memory Map bounded.
      const cutoff = new Date(Date.now() - ZD_RECENTLY_SOLVED_TTL_MS).toISOString();
      await query('DELETE FROM zd_recently_solved WHERE solved_at < $1', [cutoff]);
      const { rows } = await query(
        `SELECT ticket_id, row_json,
                FLOOR(EXTRACT(EPOCH FROM solved_at) * 1000)::bigint AS solved_at_ms
           FROM zd_recently_solved`,
      );
      for (const r of rows) {
        const id = Number(r.ticket_id);
        if (!Number.isFinite(id)) continue;
        _zdRecentlySolvedCache.set(id, {
          row: r.row_json,
          solvedAt: Number(r.solved_at_ms),
        });
      }
      console.log(`[zd-recently-solved] hydrated ${rows.length} entries from DB`);
    } catch (err) {
      console.warn('[zd-recently-solved] hydrate failed:', err?.message);
      // Don't poison the gate — let the next request retry hydration so a
      // transient DB blip on cold start doesn't permanently block the cache.
      _zdRecentlySolvedHydrate = null;
    }
  })();
  return _zdRecentlySolvedHydrate;
}

// Fire-and-forget persistence. Failure is logged but doesn't fail the
// /queue response — the in-memory Map is still authoritative for THIS
// pod's responses, and a subsequent diff will re-attempt the writes.
async function _persistRecentlySolvedDelta(insertEntries, deleteIds) {
  if (insertEntries.length === 0 && deleteIds.size === 0) return;
  try {
    const { query } = await import('../../../../src/lib/db');
    if (insertEntries.length > 0) {
      const values = [];
      const placeholders = [];
      let idx = 1;
      for (const [id, entry] of insertEntries) {
        values.push(id, JSON.stringify(entry.row), new Date(entry.solvedAt).toISOString());
        placeholders.push(`($${idx++}::bigint, $${idx++}::jsonb, $${idx++}::timestamptz)`);
      }
      // ON CONFLICT updates row_json + solved_at — handy if a ticket bounces
      // out of actionable, gets re-opened, then dropped again within 24h.
      await query(
        `INSERT INTO zd_recently_solved (ticket_id, row_json, solved_at)
              VALUES ${placeholders.join(', ')}
         ON CONFLICT (ticket_id) DO UPDATE
                 SET row_json = EXCLUDED.row_json,
                     solved_at = EXCLUDED.solved_at`,
        values,
      );
    }
    if (deleteIds.size > 0) {
      await query(
        'DELETE FROM zd_recently_solved WHERE ticket_id = ANY($1::bigint[])',
        [[...deleteIds]],
      );
    }
  } catch (err) {
    console.warn('[zd-recently-solved] persist failed:', err?.message);
  }
}

async function _diffAndStampSolved(currentActionableRows) {
  await _hydrateRecentlySolvedFromDb();

  const now = Date.now();
  const currentIds = new Set();
  for (const t of currentActionableRows) {
    if (t?.id != null) currentIds.add(t.id);
  }
  // Track every in-memory mutation so we can mirror it to the DB after.
  const insertEntries = []; // [id, { row, solvedAt }]
  const deleteIds = new Set();

  // 1. Anything in last snapshot that isn't in current → just-solved.
  //    Copy the row from the snapshot (Zendesk-side data was correct at the
  //    moment we last saw it) and stamp our own solvedAt.
  for (const [id, row] of _zdLastActionableSnapshot) {
    if (!currentIds.has(id)) {
      const entry = { row: { ...row, status: 'solved' }, solvedAt: now };
      _zdRecentlySolvedCache.set(id, entry);
      insertEntries.push([id, entry]);
    }
  }
  // 2. Anything that came BACK into actionable (re-opened) drops from cache.
  for (const id of currentIds) {
    if (_zdRecentlySolvedCache.has(id)) {
      _zdRecentlySolvedCache.delete(id);
      deleteIds.add(id);
    }
  }
  // 3. Age out entries older than 24h.
  for (const [id, entry] of _zdRecentlySolvedCache) {
    if (now - entry.solvedAt > ZD_RECENTLY_SOLVED_TTL_MS) {
      _zdRecentlySolvedCache.delete(id);
      deleteIds.add(id);
    }
  }
  // 4. Refresh snapshot for next sync.
  _zdLastActionableSnapshot.clear();
  for (const t of currentActionableRows) {
    if (t?.id != null) _zdLastActionableSnapshot.set(t.id, t);
  }

  // Mirror to DB without blocking the response. Failures are logged.
  _persistRecentlySolvedDelta(insertEntries, deleteIds).catch(() => {});
}

// ── Phase 13c (2026-05-21): non-HRX dept Zendesk fetcher ────────────────────
// Lighter than the HRX path: skips the policy_metrics DB enrichment + the
// HRX recently-solved diff + the HRX-specific 4 custom fields (those are
// HRX-territory data and not configured in other depts' Zendesk instances).
// Returns the SAME item shape so the FE renders identically — paused
// detection, basic FRT/NRT heuristic from metric_set, SLA window from the
// shared queue_sla_thresholds.zendesk config.
//
// `deptCfg` must come from resolveZendeskConfig(slug) — provides token +
// subdomain + email + group + tokenSource. If null (env vars missing) the
// fetcher returns an empty result with status='skipped' so the FE renders
// "Configure your Zendesk in Settings" rather than HRX leaking through.
async function fetchZendeskQueueForDept(deptCfg) {
  if (!deptCfg) return { items: [], status: 'skipped', count: 0, truncated: false, serverTotal: 0, error: 'Zendesk not configured for this department' };

  // 2026-05-22 (afternoon): prefer `group_id:<numeric>` over `group:"name"`.
  // The numeric group_id is stable across Zendesk group renames, and
  // Mohamed sent the GIX Immigration Experience group_id directly. Falls
  // back to name match only if no ID is configured for this dept (kept
  // so a future dept can wire just a name without the ID).
  const groupId = deptCfg.groupId || '';
  const groupName = deptCfg.group || '';
  if (!groupId && !groupName) {
    return { items: [], status: 'skipped', count: 0, truncated: false, serverTotal: 0, error: 'Dept Zendesk group not configured (neither group_id nor group name)' };
  }
  const groupClause = groupId ? `group_id:${groupId}` : `group:"${groupName}"`;

  const fetchOpts = {
    tokenOverride: deptCfg.token,
    subdomainOverride: deptCfg.subdomain || undefined,
    emailOverride: deptCfg.email || undefined,
  };
  // If subdomain/email weren't set in the dept config, fall back to the
  // shared env vars — they're shared across HRX + GIX today per
  // dept-integrations comments. The `_zendeskFetch` helper handles undefined
  // overrides by falling through to module-level constants.

  try {
    const statusQueries = ['new', 'open', 'pending', 'hold'].map(
      s => `${groupClause} status:${s}`,
    );
    const actionableResults = await Promise.all(
      statusQueries.map(q => paginatedZendeskSearchAllTime(q, { maxPages: 10 }, fetchOpts)),
    );

    let zdTruncated = false;
    let zdServerTotal = 0;
    const seenZd = new Set();
    const actionableRows = [];
    for (const { results, truncated, serverTotal } of actionableResults) {
      for (const t of results) {
        if (!seenZd.has(t.id)) { seenZd.add(t.id); actionableRows.push(t); }
      }
      if (truncated) zdTruncated = true;
      if (typeof serverTotal === 'number') zdServerTotal += serverTotal;
    }

    if (actionableRows.length === 0) {
      return {
        items: [],
        status: 'ok',
        count: 0,
        truncated: zdTruncated,
        serverTotal: zdServerTotal || 0,
        error: null,
      };
    }

    // Resolve user names — use the dept's Zendesk instance.
    const userIds = new Set();
    for (const t of actionableRows) {
      if (t.assignee_id) userIds.add(t.assignee_id);
      if (t.requester_id) userIds.add(t.requester_id);
    }
    const userMap = await batchFetchUsers(userIds, fetchOpts);

    // Same SLA thresholds — set on the team-tab and shared across depts. A
    // per-dept SLA override is a follow-up if any dept wants different limits.
    const { zendeskActiveMins, zendeskPausedMins } = await getSlaOverrides();

    const items = actionableRows.map(t => {
      const assignee = userMap[t.assignee_id] || {};
      const requester = userMap[t.requester_id] || {};
      const appStatus = ZD_STATUS_MAP[t.status] || 'new';
      const isPausedStatus = appStatus === 'waiting';

      // Lightweight SLA anchor — same shape as HRX path so the FE renders
      // the same pill. metric_set is sideloaded by Zendesk Search on
      // include=metric_sets when the param is set; if it's absent we fall
      // back to updated_at.
      const metric = t.metric_set || {};
      const tsMs = (s) => {
        if (!s) return null;
        const n = Date.parse(s);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const requesterMs = tsMs(metric.requester_updated_at);
      const assigneeMs  = tsMs(metric.assignee_updated_at);
      const assignedMs  = tsMs(metric.assigned_at);
      const createdMs   = tsMs(t.created_at);
      const updatedMs   = tsMs(t.updated_at);
      const pausedAnchorMs = assigneeMs || updatedMs || createdMs || null;

      let slaMetric = null;
      let activeAnchorMs = null;
      if (isPausedStatus && appStatus !== 'resolved') {
        if (t.status === 'pending') slaMetric = 'rwt';
        else if (t.status === 'hold') slaMetric = 'put';
      }
      if (!isPausedStatus && appStatus !== 'resolved') {
        const hasMetricSet = !!t.metric_set;
        const rtm = metric.reply_time_in_minutes;
        const replyMins = (rtm && typeof rtm === 'object') ? rtm.calendar : rtm;
        if (hasMetricSet && replyMins == null) {
          slaMetric = 'frt';
          activeAnchorMs = Math.max(createdMs || 0, assignedMs || 0) || createdMs;
        } else if (requesterMs && (!assigneeMs || requesterMs > assigneeMs)) {
          slaMetric = 'nrt';
          activeAnchorMs = requesterMs;
        } else if (!hasMetricSet) {
          if (updatedMs && (Date.now() - updatedMs) < zendeskActiveMins * 60 * 1000) {
            slaMetric = null;
          } else {
            slaMetric = 'nrt';
            activeAnchorMs = updatedMs || createdMs;
          }
        }
      }
      const slaAnchorIso = isPausedStatus
        ? (pausedAnchorMs ? new Date(pausedAnchorMs).toISOString() : t.created_at)
        : (activeAnchorMs ? new Date(activeAnchorMs).toISOString() : t.created_at);

      return {
        id: `ZD-${t.id}`,
        source: 'zendesk',
        externalId: String(t.id),
        subject: t.subject || '(no subject)',
        description: (t.description || '').substring(0, 200),
        status: appStatus,
        zdStatus: t.status || null,
        priority: ZD_PRIORITY_MAP[t.priority] || 'medium',
        type: detectType(t.subject, t.tags || []),
        country: detectCountry(t.subject, t.tags || []),
        assigneeEmail: assignee.email || null,
        assigneeName: assignee.name || null,
        requesterName: requester.name || 'Unknown',
        requesterEmail: requester.email || null,
        lastCustomerResponseAt: slaAnchorIso,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        pausedAt: isPausedStatus ? slaAnchorIso : null,
        slaMinsOverride: isPausedStatus ? zendeskPausedMins : zendeskActiveMins,
        slaMetric,
        // No HRX custom fields — return an empty record so Detail.jsx
        // doesn't crash trying to read .HRX_RESPONSIBLE etc.
        customFields: {},
        externalUrl: deptCfg.subdomain
          ? `https://${deptCfg.subdomain}.zendesk.com/agent/tickets/${t.id}`
          : (ZD_SUBDOMAIN ? `https://${ZD_SUBDOMAIN}.zendesk.com/agent/tickets/${t.id}` : ''),
        tags: t.tags || [],
        // No policy_metrics enrichment for non-HRX. slaSource hints to the
        // FE that the breach detection is the local heuristic, not Zendesk's
        // truth — pill renders the same way.
        slaSource: 'local_metric_set',
        slaBreachAt: null,
        slaFrtBreachAt: null,
        slaNrtBreachAt: null,
        slaRwtBreachAt: null,
        slaPutBreachAt: null,
      };
    });

    console.log(`[queue/${deptCfg.tokenSource || 'dept'}] Zendesk fetched ${items.length} tickets via ${groupClause}`);
    return { items, status: 'ok', count: items.length, truncated: zdTruncated, serverTotal: zdServerTotal || items.length, error: null };
  } catch (err) {
    console.warn(`[queue/dept] Zendesk fetch failed for ${groupClause}:`, err.message);
    return { items: [], status: 'error', count: 0, truncated: false, serverTotal: 0, error: err.message };
  }
}

// ── Fetch ALL Zendesk tickets (paginated) ────────────────────────────────────
async function fetchZendeskQueue() {
  if (!isZendeskConfigured()) return { items: [], status: 'skipped', error: null };

  try {
    // Zendesk Search API caps at 1,000 results per query.
    // We pull the 4 actionable statuses in parallel (was sequential before
    // 2026-05-19 — sequential added ~30s of wall-time and pushed the
    // route over the FE's 90s timeout once the semaphore from PR #680
    // started serializing scans). The memory cost is bounded because each
    // status query is itself bounded at 1000 rows; peak holds 4 × 1000
    // raw rows = ~4000 small JSON objects, well under the V8 budget that
    // the watchdog from PR #679 polices.
    const statusQueries = ['new', 'open', 'pending', 'hold'].map(
      s => `group:"${ZD_GROUP_NAME}" status:${s}`
    );
    const actionableResults = await Promise.all(
      statusQueries.map(q => paginatedZendeskSearchAllTime(q, { maxPages: 10 })),
    );

    // Track if any status query was truncated AND accumulate the
    // first-probe serverTotal (NOT the bucket-sum — see paginatedZendesk
    // SearchAllTime for the rationale).
    let zdTruncated = false;
    let zdServerTotal = 0;
    const seenZd = new Set();
    const actionableRows = [];
    for (const { results, truncated, serverTotal } of actionableResults) {
      for (const t of results) {
        if (!seenZd.has(t.id)) { seenZd.add(t.id); actionableRows.push(t); }
      }
      if (truncated) zdTruncated = true;
      if (typeof serverTotal === 'number') zdServerTotal += serverTotal;
    }

    // Diff against the previous sync's actionable set + stamp dropouts as
    // "recently solved". Mohamed's 2026-05-19 spec: replace the Zendesk
    // `status:solved updated<24hours` query entirely, which was the perf
    // bottleneck — 5-bucket fan-out + 10 pages each = up to 50 Zendesk
    // calls just for resolved. Internal diff is O(actionable) + zero
    // upstream calls.
    //
    // 2026-05-21: now async because the first call after a pod restart
    // hydrates the recently-solved Map from `zd_recently_solved` so the
    // Briefing "Resolved" KPI survives deploys.
    await _diffAndStampSolved(actionableRows);
    const recentlySolvedRows = [];
    for (const entry of _zdRecentlySolvedCache.values()) {
      if (!seenZd.has(entry.row.id)) {
        seenZd.add(entry.row.id);
        recentlySolvedRows.push(entry.row);
      }
    }

    const allTickets = [...actionableRows, ...recentlySolvedRows];
    if (allTickets.length === 0) return { items: [], status: 'ok', count: 0, truncated: zdTruncated, serverTotal: zdServerTotal || 0, error: null };

    // Collect unique user IDs for batch lookup
    const userIds = new Set();
    for (const t of allTickets) {
      if (t.assignee_id) userIds.add(t.assignee_id);
      if (t.requester_id) userIds.add(t.requester_id);
    }

    // Batch-fetch user details (handles >100 users)
    const userMap = await batchFetchUsers(userIds);

    // Resolve runtime SLA settings (Team-tab editable). Cached 30s so the
    // per-request hop is one SELECT at most.
    const { zendeskActiveMins, zendeskPausedMins } = await getSlaOverrides();

    // Resolve our 4 named custom-field IDs once per request (cached 1h
    // server-side). If discovery fails we silently fall back to null
    // values per ticket — the queue still renders, agents see "—" until
    // the next refresh recovers.
    const customFieldMeta = await resolveCustomFieldIds();

    // 2026-05-07 — the policy_metrics fetch (PR #477) was reverted
    // because it OOM'd the pod at scale. With ~2k Zendesk tickets in
    // the queue, the show_many?include=slas batch (21 calls × ~1-5MB
    // responses) on top of the existing metric_sets sideload + parallel
    // workbench/offboarding scans pushed the V8 heap past the 2GB
    // ceiling. Reverting lets us stay on #471's metric_set anchor
    // (sideloaded into the existing search calls — no extra round-trips,
    // no per-batch payload bloat). A future PR can re-introduce
    // policy_metrics via a background cron + DB cache so the queue
    // route stays cheap.

    // Normalize tickets. `metric_set` is always undefined now (Zendesk
    // Search doesn't sideload it — see paginatedZendeskSearch comment) so
    // the row-level FRT/NRT branches below all fall through to the
    // updated_at fallback path. The canonical SLA anchor is the
    // policy_metrics cache, joined in further down via loadSlaRowsForTicketIds.
    const items = allTickets.map(t => {
      const assignee = userMap[t.assignee_id] || {};
      const requester = userMap[t.requester_id] || {};
      // Read the per-ticket values for our 4 fields from t.custom_fields.
      const customFields = extractCustomFieldValues(t, customFieldMeta);
      const appStatus = ZD_STATUS_MAP[t.status] || 'new';
      // Paused buckets (`pending`/`hold`) get the paused SLA window;
      // active buckets (`new`/`open`) get the active window. The FE
      // renders a separate Paused section for waiting tickets, with its
      // own SLA pill ticking against the paused window.
      const isPausedStatus = appStatus === 'waiting';

      // ── SLA anchor (2026-05-07 fix) ────────────────────────────────
      // The previous code anchored on `t.updated_at`, which bumps on
      // ANY ticket activity — including the assignee's own internal
      // notes, custom-field edits, tag changes, or status flips. So the
      // moment the assignee touched the ticket without actually replying
      // to the requester, the SLA clock silently reset and the breach
      // was masked. (Reported symptom: Zendesk fires a breach notification
      // but Ops Hub still shows the row as OK.)
      //
      // Use the Zendesk metric_set sideload instead. metric_sets carry
      // per-actor timestamps that ONLY bump on the relevant party's
      // activity:
      //   • requester_updated_at — last requester reply
      //   • assignee_updated_at — last assignee action (any kind)
      //   • assigned_at         — when the current assignee was assigned
      //
      // Active SLA anchor (status=new/open) — "assignee owes a response":
      //   max(requester_updated_at, assigned_at) || created_at
      // This matches the user's two rules:
      //   (a) "once assigned, reply within 24h" → assigned_at
      //   (b) "if requester replies, respond within 24h" → requester_updated_at
      //
      // Paused SLA anchor (status=pending/hold) — "waiting on requester":
      //   assignee_updated_at || updated_at || created_at
      // Closest proxy for "when the ticket entered pending" since Zendesk
      // doesn't surface the status-transition timestamp directly; the
      // assignee's last action is typically the reply that flipped status.
      const metric = t.metric_set || {};
      const tsMs = (s) => {
        if (!s) return null;
        const n = Date.parse(s);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const requesterMs = tsMs(metric.requester_updated_at);
      const assigneeMs  = tsMs(metric.assignee_updated_at);
      const assignedMs  = tsMs(metric.assigned_at);
      const createdMs   = tsMs(t.created_at);
      const updatedMs   = tsMs(t.updated_at);

      const pausedAnchorMs = assigneeMs || updatedMs || createdMs || null;

      // ── FRT / NRT detection from metric_set (2026-05-07) ─────────────
      // Replaces the reverted policy_metrics fetch (#477 → #480 OOM).
      // Computes locally from data we already sideload — zero extra
      // Zendesk calls, no per-batch payload bloat.
      //
      // Two metrics:
      //   • FRT (First Reply Time)   — assignee owes the FIRST agent
      //     reply. Active when the ticket has no agent comment yet:
      //     metric_set.reply_time_in_minutes is null. Anchor =
      //     max(created_at, assigned_at) so a ticket that sat
      //     unassigned for days then got assigned doesn't appear
      //     instantly breached — Mohamed's spec: "Once they are
      //     assigned to the ticket they should be replying within
      //     24hrs". When unassigned, max() collapses to created_at
      //     and the FRT clock ticks against creation.
      //   • NRT (Next Reply Time)    — assignee owes a reply because
      //     the requester replied after the assignee's last action.
      //     Active when requester_updated_at > assignee_updated_at.
      //     Anchor = requester_updated_at.
      //
      // When neither applies, the assignee has caught up — pill shows
      // OK regardless of how stale the anchor is.
      //
      // Known limitation: NRT has a ~5% false-negative rate when the
      // assignee posts an internal note (advances assignee_updated_at
      // without a public reply). Acceptable trade-off per Mohamed's
      // 2026-05-07 spec ("im fine with the margin of error"). Switch
      // to Zendesk's policy_metrics via background cron + DB cache for
      // 100% accuracy if needed later.
      let slaMetric = null; // 'frt' | 'nrt' | 'rwt' | 'put' | null
      let activeAnchorMs = null;
      // Local default for paused statuses (2026-05-19, Track B SLA fix):
      // pending = "waiting on requester" → requester_wait_time (RWT)
      // hold    = "agent paused, needs periodic update" → periodic_update_time (PUT)
      // Both anchor on pausedAnchorMs (the assignee's last action, typically
      // the reply that flipped the ticket into the paused state) and use
      // zendeskPausedMins for the threshold. When the Zendesk SLA cache has
      // a row for this ticket, `it.slaMetric = row.activeStage` below
      // overwrites with Zendesk's truth (also possibly 'rwt' / 'put').
      if (isPausedStatus && appStatus !== 'resolved') {
        if (t.status === 'pending') slaMetric = 'rwt';
        else if (t.status === 'hold') slaMetric = 'put';
      }
      if (!isPausedStatus && appStatus !== 'resolved') {
        const hasMetricSet = !!t.metric_set;
        const rtm = metric.reply_time_in_minutes;
        const replyMins = (rtm && typeof rtm === 'object') ? rtm.calendar : rtm;
        if (hasMetricSet && replyMins == null) {
          // FRT — Zendesk metrics confirm no first agent reply yet.
          // Anchor on the later of creation OR assignment so a ticket
          // that sat unassigned for days and was just routed gets a
          // fresh 24h clock, not an instant breach.
          slaMetric = 'frt';
          activeAnchorMs = Math.max(createdMs || 0, assignedMs || 0) || createdMs;
        } else if (requesterMs && (!assigneeMs || requesterMs > assigneeMs)) {
          // NRT — requester replied after assignee's last action.
          slaMetric = 'nrt';
          activeAnchorMs = requesterMs;
        } else if (!hasMetricSet) {
          // Defensive fallback (Mohamed's ZD-5871989 case 2026-05-07):
          // when Zendesk doesn't sideload metric_set for a ticket, we
          // can't tell if FRT is satisfied. The previous code defaulted
          // to FRT with anchor=created_at — for a 4-month-old ticket
          // that produced "First reply breached by 3 months" even
          // though the agent had been actively replying.
          //
          // Use t.updated_at as a proxy for "last activity": if it's
          // within the active threshold (24h biz minutes ≈ 1440 min)
          // assume someone is engaged — pill OK. If it's stale, run a
          // generic NRT clock from updated_at so the row still shows
          // up as breached (rather than being silently OK).
          if (updatedMs && (Date.now() - updatedMs) < zendeskActiveMins * 60 * 1000) {
            // Recent activity — assume caught up; pill = OK.
            slaMetric = null;
          } else {
            slaMetric = 'nrt';
            activeAnchorMs = updatedMs || createdMs;
          }
        }
        // Else: metric_set present, first reply done, requester has
        // not replied since assignee's last action → caught up,
        // slaMetric stays null, pill = OK.
      }
      const slaAnchorIso = isPausedStatus
        ? (pausedAnchorMs ? new Date(pausedAnchorMs).toISOString() : t.created_at)
        : (activeAnchorMs ? new Date(activeAnchorMs).toISOString() : t.created_at);

      return {
        id: `ZD-${t.id}`,
        source: 'zendesk',
        externalId: String(t.id),
        subject: t.subject || '(no subject)',
        description: (t.description || '').substring(0, 200),
        status: appStatus,
        // Preserve the raw Zendesk status so the Detail page can distinguish
        // `pending` (waiting on requester) from `hold` (waiting on internal)
        // even though both collapse to our app-level 'waiting' bucket.
        zdStatus: t.status || null,
        priority: ZD_PRIORITY_MAP[t.priority] || 'medium',
        type: detectType(t.subject, t.tags || []),
        country: detectCountry(t.subject, t.tags || []),
        assigneeEmail: assignee.email || null,
        assigneeName: assignee.name || null,
        requesterName: requester.name || 'Unknown',
        requesterEmail: requester.email || null,
        // SLA anchor — see metric_set logic above. The FE's _slaAnchorMs
        // (src/utils/helpers.js) reads this field first.
        lastCustomerResponseAt: slaAnchorIso,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        // Paused-state anchor for the dedicated Paused section pill.
        // Uses metric.assignee_updated_at (the assignee's last action,
        // typically the reply that flipped status to pending) — falls back
        // to updated_at then created_at if the metric_set didn't side-load.
        pausedAt: isPausedStatus ? slaAnchorIso : null,
        // Per-ticket SLA window from app_settings.queue_sla_thresholds.zendesk
        // (default 24h active / 48h paused, configurable via the Team-tab
        // SLA settings table). slaInfo() reads this override before falling
        // back to type-based SLA_MINS.
        slaMinsOverride: isPausedStatus ? zendeskPausedMins : zendeskActiveMins,
        // FRT/NRT hint for the FE pill. 'frt' = first reply not done yet,
        // 'nrt' = requester replied after assignee's last action,
        // null = assignee caught up (paused/solved/up-to-date). When
        // null on an active ticket, slaInfo() short-circuits to OK
        // regardless of anchor staleness.
        slaMetric,
        // Phase 2 — values for the 4 ops-hub-tracked Zendesk custom fields.
        // Detail.jsx renders these as editable selects; PUT through
        // /queue/[id]/custom-fields persists changes back to Zendesk.
        customFields,
        externalUrl: ZD_SUBDOMAIN
          ? `https://${ZD_SUBDOMAIN}.zendesk.com/agent/tickets/${t.id}`
          : '',
        tags: t.tags || [],
        // Provenance — flips to 'zendesk_policy' below if the SLA cache
        // has a row for this ticket. The FE's slaInfo() reads slaSource
        // to decide whether to honour slaBreachAt directly (Zendesk's
        // truth) or fall back to the local biz-day computation against
        // slaMinsOverride (this branch).
        slaSource: 'local_metric_set',
        // Will be filled in below from the SLA cache when present. Null
        // here means "no Zendesk-policy data yet (cron hasn't reached
        // this ticket); use the local logic". Distinct from the cached
        // row that has activeStage=null (which means Zendesk says the
        // assignee has caught up) — that case is handled by setting
        // slaMetric to null AND slaSource to 'zendesk_policy'.
        slaBreachAt: null,
        slaFrtBreachAt: null,
        slaNrtBreachAt: null,
        slaRwtBreachAt: null,
        slaPutBreachAt: null,
      };
    });

    // ── Merge the SLA cache (background-synced from Zendesk policy_metrics) ──
    // Single SELECT keyed on ticket_id; falls back to local logic when the
    // cache hasn't seen a ticket yet (brand-new ticket between cron runs,
    // or sync still warming up after a fresh deploy). Never throws — the
    // helper already swallows DB errors and returns an empty Map.
    if (items.length > 0) {
      const idNums = items
        .map(it => Number(it.externalId))
        .filter(Number.isFinite);
      const slaMap = await loadSlaRowsForTicketIds(idNums);
      if (slaMap.size > 0) {
        let _enriched = 0;
        for (const it of items) {
          const id = Number(it.externalId);
          const row = slaMap.get(id);
          if (!row) continue;
          _enriched++;
          // Zendesk's policy is the truth — overwrite the local FRT/NRT
          // detection. activeStage may be null (assignee caught up); that
          // path is intentional and slaInfo() short-circuits to OK on it.
          // For paused statuses, activeStage typically comes back as 'rwt'
          // (requester_wait_time) or 'put' (periodic_update_time) which
          // overrides the local-default we set above for pending/hold.
          it.slaSource      = 'zendesk_policy';
          it.slaMetric      = row.activeStage;
          it.slaBreachAt    = row.activeBreachAt;
          it.slaFrtBreachAt = row.frtBreachAt;
          it.slaFrtMinutes  = row.frtMinutes;
          it.slaNrtBreachAt = row.nrtBreachAt;
          it.slaNrtMinutes  = row.nrtMinutes;
          it.slaRwtBreachAt = row.rwtBreachAt;
          it.slaRwtMinutes  = row.rwtMinutes;
          it.slaPutBreachAt = row.putBreachAt;
          it.slaPutMinutes  = row.putMinutes;
        }
        if (_enriched > 0) {
          console.log(`[queue] Zendesk SLA cache: ${_enriched}/${items.length} tickets enriched from policy_metrics`);
        }
      }
      // Fire-and-forget hot-warm for IDs still in local-fallback mode
      // (cache miss). The 2026-05-18 helpers.js change renders those as
      // "SLA syncing" instead of the previous biz-day-math breach; this
      // warm closes the gap so the next refresh (~30 s) carries real
      // Zendesk policy_metrics. Capped at 25 IDs per call inside the
      // sync helper to respect Zendesk's rate limit.
      const missingIds = items
        .filter(it => it.slaSource === 'local_metric_set')
        .map(it => Number(it.externalId))
        .filter(Number.isFinite);
      if (missingIds.length > 0) {
        // Use setImmediate so the warm starts AFTER the response has
        // been queued for the caller. .catch() prevents an unhandled
        // rejection if the warm loop trips during a Zendesk outage.
        setImmediate(() => {
          warmSlaCacheForTicketIds(missingIds)
            .catch(err => console.warn('[queue] Zendesk SLA warm failed:', err?.message));
        });
      }
    }

    return { items, status: 'ok', count: items.length, truncated: zdTruncated, serverTotal: zdServerTotal || items.length, error: null };
  } catch (err) {
    console.error('[queue] Zendesk fetch error:', err.message);
    return { items: [], status: 'error', truncated: false, serverTotal: 0, error: 'Zendesk fetch failed' };
  }
}

// ── Build JQL for registered emails ──────────────────────────────────────────
// A ticket surfaces in our queue whenever ANY of the following roles is one of
// our registered team emails (Pilar's 2026-04-22 rule):
//   • built-in `assignee`
//   • built-in `reporter`
//   • "HRX Responsible" user-picker custom field
//
// The ticket must ALSO be in an actionable state — any status that means
// "done" (closed, resolved, cancelled, rejected, denied, withdrawn, etc.)
// is excluded. No done-grace window — if a ticket transitioned to a closed
// state, it's out of our queue immediately.
//
// ── Why we return AN ARRAY of queries instead of one big OR ────────────────
// With 100+ registered emails, concatenating every role into a single OR-of-
// IN clause produces a JQL string whose URL-encoded form exceeds Atlassian's
// ~8KB edge-proxy limit — the fetch returns HTTP 414 ("Request-URI Too Long")
// and the queue feed goes dark. To stay robust, and to avoid depending on the
// POST /search/jql endpoint (which behaves inconsistently across tenants),
// we run ONE query per role clause. Each JQL is ~3KB and fits comfortably in
// a normal GET. fetchJiraQueue unions the per-query results and dedups by
// issue key, so user-visible behavior is identical to a single OR.
//
// ── Why we ALSO chunk the email IN-list (2026-04-23, revised 2026-05-05) ──
// Previously we ran one query per role with ALL ~104 emails in a single IN
// clause, capped at 300 issues/clause. Across 104 people that cap is far
// below the actual volume of in-flight work, so the query truncated —
// always dropping the oldest-`updated` tickets first. That's exactly the
// CLIENT APPROVAL / EOR SIGNING / PRM REVIEW / "pending another team"
// buckets (they sit stale for weeks waiting on externals), so agents like
// Susana and Anne saw wildly under-counted queues ("84 expected, 15 shown").
// The fix: chunk ADMIN_EMAILS_LIST + cap each sub-query at a count that
// comfortably exceeds typical chunk volume. Combined cap math:
//
//   With EMAIL_CHUNK_SIZE=20 and ~50 active tickets per agent, a chunk
//   carries up to ~1000 tickets. The original 300 cap was below that
//   ceiling, so the same "oldest paused dropped first" failure mode
//   resurfaced — Anne reported "4 paused but only 2 appear" on
//   2026-05-05 because two of her older client-approval rows fell off
//   the 300-tail of the assignee chunk she sat in. Bumping
//   MAX_ISSUES_PER_CLAUSE to 2000 keeps the runaway-pagination guard
//   (50 + 1 pages of 100) without truncating real data.
//
// ── Why we filter by statusCategory, not by status-name list (2026-04-23) ──
// Earlier iteration used `status NOT IN ("Done", "Closed", ...)` — a hand-
// maintained blocklist of status-name strings. Jira workflows can name their
// terminal states anything (e.g. "Done: Work Completed", "Done/Approved",
// "Completed by Vendor"), and any name not in our list slipped through.
// Pilar flagged EXPOS-26770 ("Done: Work Completed") appearing in the queue
// as a result. The fix: use Jira's built-in `statusCategory` taxonomy —
// every status in every workflow is mapped by the project admin to exactly
// one of three categories: New / Indeterminate / Done. Filtering by
// `statusCategory != Done` catches every terminal state regardless of what
// it's named. Belt-and-suspenders: keep the resolution filter to also drop
// issues marked resolved while still sitting in an indeterminate status.

// Group size for chunking ADMIN_EMAILS_LIST in Jira IN-clauses. Keeps each
// sub-query's total ticket count below MAX_ISSUES_PER_CLAUSE so stale-status
// tickets aren't truncated by the ORDER BY updated DESC tail.
const EMAIL_CHUNK_SIZE = 20;

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildJiraJqlQueries(ownerFieldIds = {}) {
  // Project allow-list — the queue is restricted to JIRA_PROJECT_KEYS
  // (COHD, OSHD). Anything outside (EOR Compliance / EC, etc.) never
  // enters the result set even when an HRX teammate is the assignee or
  // reporter on it. This is the single front-door filter that prevents
  // off-team projects bleeding into the ops queue.
  const projectFilter = `project IN (${JIRA_PROJECT_KEYS.join(', ')})`;
  // statusCategory is Jira's universal 3-value taxonomy (New/Indeterminate/
  // Done) that every custom status is mapped to — drops "Done: Work
  // Completed" and any other creative name without us maintaining a list.
  // Paired with resolution to also drop resolved-but-still-open-statuswise.
  const statusFilter = `statusCategory != Done AND (resolution IS EMPTY OR resolution = Unresolved)`;
  // Recently-resolved tickets — keep them visible for 24h after they
  // transition to Done so the "Resolved (last 24h)" count never gaps when
  // the team closes a batch overnight. JQL `resolved >= -24h` is a Jira-
  // native relative time bound, no client-side post-filter needed.
  const resolvedFilter = `statusCategory = Done AND resolved >= -24h`;

  // 2026-05-22 REVERTED: the JQL-based dept exclusion I shipped in #785
  // dropped to ZERO HRX tickets in prod. Cause: Jira's 3-valued logic.
  // For a typical HRX ticket with no `Team[Team]` and no `"Request Type"`
  // set, those clauses evaluate to UNKNOWN, an OR of UNKNOWNs is UNKNOWN,
  // and NOT(UNKNOWN) is UNKNOWN — which Jira treats as "no match" and
  // filters the row out. So every HRX ticket without those GIX-specific
  // fields explicitly set got dropped. Reverting to the pre-#785 JQL
  // restores HRX immediately. HRX/GIX overlap-prevention on the Jira
  // side will be reintroduced as a POST-FETCH filter (after we
  // materialise Team + Request Type per ticket) in a follow-up; that's
  // 3VL-safe since we compare actual values in JS, not in JQL.
  // Workbench's exclusion (in deel-api.js#listWorkbenchTasks) is already
  // post-fetch and keeps working — no revert needed there.

  // Roles that can make a ticket "ours": primary assignee, reporter, plus
  // any HRX-owner custom fields discovered dynamically.
  const roleFields = ['assignee', 'reporter'];
  for (const cfId of Object.values(ownerFieldIds)) {
    if (!cfId) continue;
    const num = String(cfId).replace(/^customfield_/, '');
    roleFields.push(`cf[${num}]`);
  }

  // One query per (role × email-chunk × bucket). Each is self-contained
  // (own filter + ORDER BY) so per-clause pagination works normally and
  // fetchJiraQueue unions+dedups across them.
  const emailChunks = chunkArray(ADMIN_EMAILS_LIST, EMAIL_CHUNK_SIZE);
  const queries = [];
  for (const roleField of roleFields) {
    for (const chunk of emailChunks) {
      const emailsList = chunk.map(e => `"${e}"`).join(', ');
      queries.push(`${projectFilter} AND ${roleField} IN (${emailsList}) AND ${statusFilter} ORDER BY updated DESC`);
      queries.push(`${projectFilter} AND ${roleField} IN (${emailsList}) AND ${resolvedFilter} ORDER BY resolved DESC`);
    }
  }
  return queries;
}

// ── Fetch Jira issues (paginated per clause, unioned) ──────────────────────
async function fetchJiraQueue() {
  if (!isJiraConfigured()) return { items: [], status: 'skipped', error: null };

  try {
    // Resolve runtime SLA settings (Team-tab editable). Cached 30s.
    const { jiraMins } = await getSlaOverrides();

    // Discover the HRX-owner custom field IDs once per hour (cached in
    // jira-api). If discovery fails the map is empty and we fall back to
    // assignee + reporter only — never breaks the queue.
    const ownerFieldIds = await resolveHrxOwnerFields(HRX_OWNER_FIELD_NAMES);
    const ownerFieldList = Object.values(ownerFieldIds);

    const jqlQueries = buildJiraJqlQueries(ownerFieldIds);
    const allIssues = [];
    const seenKeys = new Set();       // dedup across clauses — same key never lands twice
    const pageSize = 100;
    // Safety cap per clause. Was 300 — bumped 2026-05-05 because at
    // EMAIL_CHUNK_SIZE=20 a busy chunk can carry well over 300 active
    // tickets and `ORDER BY updated DESC` was silently dropping the
    // oldest paused/Client-Approval/EOR-Signing rows. 2000 covers
    // realistic chunk volumes; the runaway-pagination guard via
    // MAX_PAGES below still bounds total fetches.
    const MAX_ISSUES_PER_CLAUSE = 2000;
    // True when at least one clause stopped at MAX_ISSUES_PER_CLAUSE while
    // the server still had more rows to give. Surfaced in the response meta
    // so the FE can warn that the queue listing is capped (Sarah Suge
    // 2026-05-11 feedback).
    let jiraTruncated = false;

    const fieldsToFetch = [
      'summary', 'status', 'assignee', 'reporter', 'priority',
      'created', 'updated', 'issuetype', 'project', 'labels',
      'description',
      ...ownerFieldList,
    ];

    // Paginate each clause independently; union the results. Running them
    // sequentially (instead of Promise.all) keeps Jira rate-limit headroom
    // and avoids any single request's backoff stalling the others.
    //
    // Pagination note: Jira Cloud's /search/jql endpoint uses token-based
    // cursor pagination via `nextPageToken` (not offset `startAt`). The
    // response tells us we're done via `isLast === true` or a missing
    // `nextPageToken`. See src/lib/jira-api.js for the full rationale.
    for (const jql of jqlQueries) {
      let nextPageToken; // undefined → first page
      let fetched = 0;
      let safetyPages = 0;
      const MAX_PAGES = Math.ceil(MAX_ISSUES_PER_CLAUSE / pageSize) + 1;

      while (true) {
        let result;
        try {
          result = await searchIssues(jql, {
            maxResults: pageSize,
            nextPageToken,
            fields: fieldsToFetch,
          });
        } catch (clauseErr) {
          // One clause failing must not take the whole queue down — log and
          // move on to the next clause so users still see the majority of
          // their tickets.
          console.warn('[queue] Jira clause failed, continuing:', clauseErr.message);
          break;
        }

        const issues = result?.issues || [];
        for (const issue of issues) {
          if (issue?.key && !seenKeys.has(issue.key)) {
            seenKeys.add(issue.key);
            allIssues.push(issue);
          }
        }
        fetched += issues.length;

        // Stop conditions for the new /search/jql endpoint:
        //   - server says we've hit the last page (isLast)
        //   - no token to get the next page
        //   - we've hit the per-clause safety cap
        //   - page request count safety cap (defensive; protects against a
        //     server that never stops returning `nextPageToken`)
        if (result?.isLast) break;
        if (!result?.nextPageToken) break;
        if (fetched >= MAX_ISSUES_PER_CLAUSE) {
          // The clause still has more rows behind it but we're stopping for
          // safety. Mark as truncated so the FE knows to hint at filtering.
          if (!result?.isLast && result?.nextPageToken) jiraTruncated = true;
          break;
        }
        if (++safetyPages >= MAX_PAGES) {
          if (!result?.isLast && result?.nextPageToken) jiraTruncated = true;
          break;
        }

        nextPageToken = result.nextPageToken;
      }
    }

    const items = allIssues.map(issue => {
      const f = issue.fields || {};
      const statusName = f.status?.name || '';
      // Jira returns status.statusCategory.key ∈ {"new","indeterminate","done"}
      // — the universal 3-value taxonomy every workflow's statuses are mapped
      // to. We use it as a robust fallback when a custom status name
      // (e.g. "Done: Work Completed") isn't in JIRA_STATUS_MAP.
      const statusCategoryKey = (f.status?.statusCategory?.key || '').toLowerCase();
      const priorityName = f.priority?.name || '';
      const assignee = f.assignee || {};
      const reporter = f.reporter || {};

      // Status: prefer fine-grained name match (gives us "waiting" for
      // "Client Approval" etc.), fall back to statusCategory for unmapped
      // names so we never mislabel a done ticket as in_progress.
      const statusFromCategory =
        statusCategoryKey === 'done' ? 'resolved' :
        statusCategoryKey === 'new'  ? 'new' :
        'in_progress'; // 'indeterminate' or unknown
      const appStatus = JIRA_STATUS_MAP[statusName.toLowerCase()] || statusFromCategory;

      // Collect every email associated with this ticket via roles OTHER than
      // the primary assignee — used by the scoping layer so the ticket is
      // visible to e.g. the Country Owner, HRX Responsible, or Reporter even
      // when they aren't the assignee. Deduped via Set.
      //
      // We also track HRX-responsible and reporter emails SEPARATELY so the
      // client can classify each ticket as "Actionable" (assignee or HRX
      // responsible) vs "Raised by You" (reporter only). Ljubica's
      // 2026-04-23 ask: tickets where a teammate is only the reporter (not
      // the HRX Responsible) were surfacing as "your breached items" — they
      // should be reachable via a separate filter but excluded from the
      // default Actionable view. Tickets where a user is BOTH reporter AND
      // HRX responsible stay in Actionable (non-exclusive classification).
      const hrxEmails = new Set();
      for (const cfId of Object.values(ownerFieldIds)) {
        if (!cfId) continue;
        const emails = emailsFromJiraFieldValue(f[cfId]);
        for (const e of emails) hrxEmails.add(e);
      }
      const reporterEmailLower = reporter.emailAddress
        ? reporter.emailAddress.toLowerCase()
        : null;
      // Union for visibility — keep existing scoping behaviour (see
      // src/lib/queue-scoping.js::filterByAssignee) so no ticket drops out
      // of the dataset.
      const ownerEmails = new Set(hrxEmails);
      if (reporterEmailLower) ownerEmails.add(reporterEmailLower);

      return {
        id: issue.key,
        source: 'jira',
        externalId: issue.key,
        subject: f.summary || '(no summary)',
        description: adfToText(f.description).substring(0, 200),
        status: appStatus,
        priority: JIRA_PRIORITY_MAP[priorityName.toLowerCase()] || 'medium',
        type: detectType(f.summary, [], f.labels || []),
        country: detectCountry(f.summary, f.labels || []),
        assigneeEmail: assignee.emailAddress || null,
        assigneeName: assignee.displayName || null,
        // Secondary visibility: HRX-owner custom fields + Reporter. Scoping
        // matches on primary assignee OR any secondary — see
        // src/lib/queue-scoping.js::filterByAssignee.
        secondaryAssigneeEmails: [...ownerEmails],
        // Per-role breakdown for client-side Actionable / Raised by You
        // classification. Lowercased for consistent comparison on the client.
        jiraHrxEmails: [...hrxEmails],
        jiraReporterEmail: reporterEmailLower,
        requesterName: reporter.displayName || 'System',
        requesterEmail: reporter.emailAddress || null,
        lastCustomerResponseAt: f.updated, // Jira updated tracks last activity
        createdAt: f.created,
        updatedAt: f.updated,
        // Per-ticket SLA window from app_settings.queue_sla_thresholds.jira
        // (default 48h, configurable via the Team-tab SLA settings table).
        // slaInfo() reads this override before falling back to SLA_MINS[type].
        slaMinsOverride: jiraMins,
        externalUrl: JIRA_BASE ? `${JIRA_BASE}/browse/${issue.key}` : '',
        tags: f.labels || [],
        jiraStatus: statusName,
        jiraType: f.issuetype?.name || null,
      };
    });

    return { items, status: 'ok', count: items.length, truncated: jiraTruncated, error: null };
  } catch (err) {
    console.error('[queue] Jira fetch error:', err.message);
    return { items: [], status: 'error', truncated: false, error: 'Jira fetch failed' };
  }
}

// ── Phase 13c (2026-05-21): non-HRX dept Jira fetcher ───────────────────────
// Pulls Jira tickets where the dept's team field matches one of the
// configured ownerFieldValues. Lighter than the HRX path: no email chunking
// (deptCfg.ownerFieldValues is a small list of team names, not 100+ emails),
// no HRX_OWNER_FIELD_NAMES discovery, no custom-field plumbing — just one
// JQL query per (value × bucket).
//
// Filter strategy: Jira's built-in Team custom field is `"Team[Team]"` in
// JQL syntax. For GIX this matches tickets tagged with the "Global Mobility"
// team. If the live GIX Jira setup uses a different custom field (e.g.
// 'Assigned Team', 'Department'), surface the actual field name and we'll
// extend dept-integrations.js with an explicit `ownerJqlField` config knob.
async function fetchJiraQueueForDept(deptCfg) {
  if (!deptCfg) return { items: [], status: 'skipped', count: 0, truncated: false, error: 'Jira not configured for this department' };

  // 2026-05-22: `jqlClauses` is the preferred config shape (multi-clause).
  // The dept fetcher iterates each clause × {active, resolved-24h} and
  // de-dupes by issue.key. Legacy `projectKeys + ownerFieldValues` is
  // collapsed to a single equivalent clause for back-compat.
  let baseClauses = Array.isArray(deptCfg.jqlClauses) ? deptCfg.jqlClauses.slice() : null;
  if ((!baseClauses || baseClauses.length === 0)
      && Array.isArray(deptCfg.projectKeys) && deptCfg.projectKeys.length > 0
      && Array.isArray(deptCfg.ownerFieldValues) && deptCfg.ownerFieldValues.length > 0) {
    const projs = deptCfg.projectKeys.join(', ');
    const teams = deptCfg.ownerFieldValues.map(v => `"${v}"`).join(', ');
    baseClauses = [`project IN (${projs}) AND "Team[Team]" in (${teams})`];
  }
  if (!baseClauses || baseClauses.length === 0) {
    return { items: [], status: 'skipped', count: 0, truncated: false, error: 'Dept Jira config has no clauses (set jqlClauses or projectKeys+ownerFieldValues)' };
  }

  const fetchOpts = {
    tokenOverride: deptCfg.token,
    baseUrlOverride: deptCfg.baseUrl || undefined,
    emailOverride: deptCfg.email || undefined,
  };

  try {
    const { jiraMins } = await getSlaOverrides();
    const statusFilter = `statusCategory != Done AND (resolution IS EMPTY OR resolution = Unresolved)`;
    const resolvedFilter = `statusCategory = Done AND resolved >= -24h`;

    // Active + resolved-in-24h per base clause. ORDER BY differs per
    // bucket so each clause's pagination prioritises the freshest rows.
    const jqlQueries = [];
    for (const base of baseClauses) {
      jqlQueries.push(`${base} AND ${statusFilter} ORDER BY updated DESC`);
      jqlQueries.push(`${base} AND ${resolvedFilter} ORDER BY resolved DESC`);
    }

    const allIssues = [];
    const seenKeys = new Set();
    const pageSize = 100;
    const MAX_ISSUES_PER_CLAUSE = 2000;
    let jiraTruncated = false;

    const fieldsToFetch = [
      'summary', 'status', 'assignee', 'reporter', 'priority',
      'created', 'updated', 'issuetype', 'project', 'labels', 'description',
    ];

    // Track per-clause failures so a fully-broken config (wrong token,
    // bad field name, etc.) returns status='error' instead of silently
    // looking like "all clauses returned 0 results". 2026-05-22 GIX
    // diagnostic surfaced this gap.
    let clausesAttempted = 0;
    let clausesFailed = 0;
    const clauseErrors = [];

    for (const jql of jqlQueries) {
      clausesAttempted++;
      let nextPageToken;
      let fetched = 0;
      let safetyPages = 0;
      let clauseErrored = false;
      const MAX_PAGES = Math.ceil(MAX_ISSUES_PER_CLAUSE / pageSize) + 1;
      while (true) {
        let result;
        try {
          result = await searchIssues(jql, {
            maxResults: pageSize,
            nextPageToken,
            fields: fieldsToFetch,
          }, fetchOpts);
        } catch (clauseErr) {
          console.warn('[queue/dept] Jira clause failed, continuing:', clauseErr.message);
          if (!clauseErrored) {
            clauseErrored = true;
            clausesFailed++;
            // Capture the first error per clause; subsequent paginate
            // failures of the same clause don't add noise. Truncated to
            // 200 chars so a long Jira response body can't bloat the
            // meta payload.
            clauseErrors.push(String(clauseErr.message || clauseErr).slice(0, 200));
          }
          break;
        }
        const issues = result?.issues || [];
        for (const issue of issues) {
          if (issue?.key && !seenKeys.has(issue.key)) {
            seenKeys.add(issue.key);
            allIssues.push(issue);
          }
        }
        fetched += issues.length;
        if (result?.isLast) break;
        if (!result?.nextPageToken) break;
        if (fetched >= MAX_ISSUES_PER_CLAUSE) {
          if (!result?.isLast && result?.nextPageToken) jiraTruncated = true;
          break;
        }
        if (++safetyPages >= MAX_PAGES) {
          if (!result?.isLast && result?.nextPageToken) jiraTruncated = true;
          break;
        }
        nextPageToken = result.nextPageToken;
      }
    }

    // If every clause failed, surface that as an error rather than
    // pretending the queue is empty. A partial failure (some clauses
    // worked, some didn't) keeps status='ok' so the working data still
    // renders, but the error list reaches the FE meta payload.
    if (clausesAttempted > 0 && clausesFailed === clausesAttempted) {
      return {
        items: [], status: 'error', count: 0, truncated: false,
        error: `All ${clausesAttempted} Jira clauses failed: ${clauseErrors[0]}`,
      };
    }

    const items = allIssues.map(issue => {
      const f = issue.fields || {};
      const statusName = f.status?.name || '';
      const statusCategoryKey = (f.status?.statusCategory?.key || '').toLowerCase();
      const priorityName = f.priority?.name || '';
      const assignee = f.assignee || {};
      const reporter = f.reporter || {};

      const statusFromCategory =
        statusCategoryKey === 'done' ? 'resolved' :
        statusCategoryKey === 'new'  ? 'new' :
        'in_progress';
      const appStatus = JIRA_STATUS_MAP[statusName.toLowerCase()] || statusFromCategory;

      const reporterEmailLower = reporter.emailAddress
        ? reporter.emailAddress.toLowerCase()
        : null;
      const ownerEmails = new Set();
      if (reporterEmailLower) ownerEmails.add(reporterEmailLower);
      if (assignee.emailAddress) ownerEmails.add(assignee.emailAddress.toLowerCase());

      return {
        id: issue.key,
        source: 'jira',
        externalId: issue.key,
        subject: f.summary || '(no summary)',
        description: adfToText(f.description).substring(0, 200),
        status: appStatus,
        priority: JIRA_PRIORITY_MAP[priorityName.toLowerCase()] || 'medium',
        type: detectType(f.summary, [], f.labels || []),
        country: detectCountry(f.summary, f.labels || []),
        assigneeEmail: assignee.emailAddress || null,
        assigneeName: assignee.displayName || null,
        secondaryAssigneeEmails: [...ownerEmails],
        // No HRX-owner custom fields in non-HRX projects — assignee + reporter
        // are the visibility cohort. jiraHrxEmails empty so the FE's
        // "Raised by You" vs "Actionable" classifier defaults to assignee.
        jiraHrxEmails: [],
        jiraReporterEmail: reporterEmailLower,
        requesterName: reporter.displayName || 'System',
        requesterEmail: reporter.emailAddress || null,
        lastCustomerResponseAt: f.updated,
        createdAt: f.created,
        updatedAt: f.updated,
        slaMinsOverride: jiraMins,
        externalUrl: JIRA_BASE ? `${JIRA_BASE}/browse/${issue.key}` : '',
        tags: f.labels || [],
        jiraStatus: statusName,
        jiraType: f.issuetype?.name || null,
      };
    });

    const partialError = clausesFailed > 0
      ? `${clausesFailed}/${clausesAttempted} Jira clauses failed: ${clauseErrors[0]}`
      : null;
    console.log(`[queue/${deptCfg.tokenSource || 'dept'}] Jira fetched ${items.length} tickets across ${baseClauses.length} clause(s)${partialError ? ` (${clausesFailed} clause(s) failed)` : ''}`);
    return { items, status: 'ok', count: items.length, truncated: jiraTruncated, error: partialError };
  } catch (err) {
    console.error('[queue/dept] Jira fetch error:', err.message);
    return { items: [], status: 'error', count: 0, truncated: false, error: err.message };
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────
// Supports per-source fetching via ?source=zendesk|jira for independent sync.
// Without ?source, fetches both (legacy/combined mode).
export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Hydrate server roster from team_member_overrides so scopeQueueItems sees
  // the latest roster (TTL-gated; collapses concurrent calls into one query).
  await ensureRosterHydrated();

  // Phase 13c (2026-05-21): dispatch by current dept.
  //   • HRX: the original 1300-line fetchZendeskQueue + fetchJiraQueue
  //     run with HRX env vars + the HRX-specific email roster.
  //   • Non-HRX dept: dispatch to the lightweight fetchZendeskQueueForDept
  //     + fetchJiraQueueForDept using the dept's tokens + group + team
  //     filter from src/lib/dept-integrations.js. The cache key includes
  //     the dept slug so HRX + non-HRX never share a cache row.
  const deptInfo = await getCurrentDeptSlugAndId(user, req);
  const deptSlug = deptInfo?.deptSlug || null;
  const isHrx = !deptInfo || deptSlug === SLUGS.HR_EXPERIENCE;
  const deptZendeskCfg = isHrx ? null : resolveZendeskConfig(deptSlug);
  const deptJiraCfg = isHrx ? null : resolveJiraConfig(deptSlug);
  // Per-dept cache namespace so a non-HRX dispatch never serves a
  // stale HRX payload (or vice versa). The deptSlug is the natural
  // partition key; for HRX we use 'hrx' for readability.
  const cacheNS = isHrx ? SLUGS.HR_EXPERIENCE : (deptSlug || 'no-dept');

  const url = new URL(req.url);
  const bustCache = url.searchParams.has('_t');
  const source = url.searchParams.get('source'); // 'zendesk' | 'jira' | null (both)

  // ── Per-source fetch (new: independent sync per source) ───────────────────
  if (source === 'zendesk' || source === 'jira') {
    // Per-dept cache namespace — HRX cache rows never overlap a non-HRX
    // dispatch result (and vice versa). Important: a viewer flipping the
    // dept-picker chip from HRX → GIX must NOT see a recent HRX cache hit
    // here.
    const cacheKey = `queue_${source}_${cacheNS}`;
    const ttl = source === 'zendesk' ? 2 * 60_000 : 3 * 60_000; // ZD 2min, Jira 3min

    if (!bustCache) {
      const fresh = cacheGet(cacheKey, ttl);
      if (fresh) {
        return NextResponse.json({
          ...fresh,
          items: scopeQueueItems(fresh.items || [], user),
        });
      }
    }

    let result;
    try {
      // Phase 13c dispatch: pick the HRX path or the per-dept lightweight
      // fetcher based on the resolved dept-slug. A non-HRX dept with
      // unconfigured env vars returns an empty {items: []} — the FE shows
      // the "configure your integrations" empty state instead of HRX data.
      let fetched;
      if (source === 'zendesk') {
        fetched = isHrx ? await fetchZendeskQueue() : await fetchZendeskQueueForDept(deptZendeskCfg);
      } else {
        fetched = isHrx ? await fetchJiraQueue() : await fetchJiraQueueForDept(deptJiraCfg);
      }
      result = {
        source,
        items: fetched.items,
        meta: {
          count: fetched.count || 0,
          status: fetched.status,
          error: fetched.error,
          // Truncation surfaces when the per-source pagination loop bailed at
          // its safety cap (Zendesk Search's 1000-result hard limit per
          // status, Jira's MAX_ISSUES_PER_CLAUSE) while the server still had
          // more rows. The FE banner uses this to tell the viewer to refine
          // their filter so they aren't blind to hidden tickets.
          truncated: !!fetched.truncated,
          serverTotal: fetched.serverTotal || null,
        },
        syncedAt: new Date().toISOString(),
      };
      cacheSet(cacheKey, result);
    } catch (fetchErr) {
      const stale = cacheGet(cacheKey, STALE_TTL);
      if (stale) {
        console.warn(`[queue/${source}/${cacheNS}] Fetch failed, returning stale:`, fetchErr.message);
        return NextResponse.json({
          ...stale,
          items: scopeQueueItems(stale.items || [], user),
          _stale: true,
        });
      }
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ...result,
      items: scopeQueueItems(result.items, user),
    });
  }

  // ── Combined fetch (legacy: both sources in one call) ─────────────────────
  const combinedCacheKey = `${CACHE_KEY}_${cacheNS}`;
  if (!bustCache) {
    const fresh = cacheGet(combinedCacheKey, CACHE_TTL);
    if (fresh) {
      return NextResponse.json({
        ...fresh,
        items: scopeQueueItems(fresh.items || [], user),
      });
    }
  }

  const stale = !bustCache ? cacheGet(combinedCacheKey, STALE_TTL) : null;

  let response;
  try {
    const [zendesk, jira] = await Promise.all([
      isHrx ? fetchZendeskQueue() : fetchZendeskQueueForDept(deptZendeskCfg),
      isHrx ? fetchJiraQueue() : fetchJiraQueueForDept(deptJiraCfg),
    ]);

    const seen = new Set();
    const items = [];
    for (const item of [...zendesk.items, ...jira.items]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }

    response = {
      items,
      meta: {
        zendesk: {
          count: zendesk.count || 0,
          status: zendesk.status,
          error: zendesk.error,
          truncated: !!zendesk.truncated,
          serverTotal: zendesk.serverTotal || null,
        },
        jira: {
          count: jira.count || 0,
          status: jira.status,
          error: jira.error,
          truncated: !!jira.truncated,
        },
        syncedAt: new Date().toISOString(),
        totalActive: items.filter(i => i.status !== 'resolved').length,
        totalResolved: items.filter(i => i.status === 'resolved').length,
      },
    };

    // Cache combined result only — per-source caches are populated independently
    // to avoid tripling memory usage by storing the same data 3x.
    cacheSet(combinedCacheKey, response);
  } catch (fetchErr) {
    if (stale) {
      console.warn(`[queue/${cacheNS}] Fetch failed, returning stale cache:`, fetchErr.message);
      return NextResponse.json({
        ...stale,
        items: scopeQueueItems(stale.items || [], user),
        _stale: true,
      });
    }
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ...response,
    items: scopeQueueItems(response.items, user),
  });
}

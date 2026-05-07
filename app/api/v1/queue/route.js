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
import { searchIssues, isJiraConfigured, resolveHrxOwnerFields, emailsFromJiraFieldValue } from '../../../../src/lib/jira-api';

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
// Sideloads `metric_sets` so each ticket carries a `metric_set` field with
// the SLA-relevant timestamps (requester_updated_at, assignee_updated_at,
// assigned_at). Without metric_sets the only available anchor is
// `updated_at`, which silently masks SLA breaches because it bumps on
// every assignee action (internal notes, field edits, status flips) — not
// just on a real requester reply. See fetchZendeskQueue's normalize step
// for the anchor formula.
async function paginatedZendeskSearch(query, { maxPages = 10, perPage = 100 } = {}) {
  const allResults = [];
  const metricsByTicketId = new Map();
  let page = 1;

  while (page <= maxPages) {
    const res = await searchTickets(query, {
      per_page: perPage,
      page,
      sort_by: 'updated_at',
      sort_order: 'desc',
      include: 'metric_sets',
    });
    const results = res?.results || [];
    const metrics = res?.metric_sets || [];
    for (const m of metrics) {
      if (m && m.ticket_id != null) metricsByTicketId.set(m.ticket_id, m);
    }
    allResults.push(...results);

    // Stop if we got fewer than perPage (last page) or no next_page
    if (results.length < perPage || !res?.next_page) break;
    page++;
  }

  // Attach the metric_set sideload to each ticket so the normaliser can
  // read SLA timestamps without managing the join. Tickets without a
  // matching metric_set (race window between creation and metric
  // computation) fall through with `metric_set` undefined; downstream
  // anchor logic falls back to created_at.
  for (const t of allResults) {
    if (t && t.id != null && metricsByTicketId.has(t.id)) {
      t.metric_set = metricsByTicketId.get(t.id);
    }
  }

  return allResults;
}

// ── Batch user lookup with pagination (handles >100 users) ───────────────────
async function batchFetchUsers(userIds) {
  const userMap = {};
  const idArray = [...userIds];

  // Process in batches of 100
  for (let i = 0; i < idArray.length; i += 100) {
    const batch = idArray.slice(i, i + 100);
    try {
      const res = await showManyUsers(batch);
      for (const u of (res?.users || [])) {
        userMap[u.id] = { name: u.name, email: u.email };
      }
    } catch (err) {
      console.warn(`[queue] Zendesk user batch ${i}-${i + batch.length} failed:`, err.message);
    }
  }

  return userMap;
}

// ── Fetch ALL Zendesk tickets (paginated) ────────────────────────────────────
async function fetchZendeskQueue() {
  if (!isZendeskConfigured()) return { items: [], status: 'skipped', error: null };

  try {
    // Zendesk Search API caps at 1,000 results per query.
    // Each status is queried independently so we can pull up to 1,000 per
    // status (10 pages × 100). Sequential to limit peak memory.
    const seenZd = new Set();
    const allTickets = [];

    const statusQueries = ['new', 'open', 'pending', 'hold'].map(
      s => `group:"${ZD_GROUP_NAME}" status:${s}`
    );
    // Fetch each status sequentially (not parallel) to reduce peak memory
    for (const q of statusQueries) {
      const results = await paginatedZendeskSearch(q, { maxPages: 10 });
      for (const t of results) {
        if (!seenZd.has(t.id)) { seenZd.add(t.id); allTickets.push(t); }
      }
    }
    // Recently solved (last 24 hours) — keeps resolved tickets visible in
    // the queue for a full day after they leave the active state. Pilar's
    // rule: "always show the resolved items in the past 24h with no data
    // loss across all Qs". Was 4 hours; bumped so a ticket Trish solved
    // overnight is still represented in this morning's "resolved today"
    // count. Page count bumped to 5 to keep the 24h window fully covered
    // for high-volume teams.
    const solvedQuery = `group:"${ZD_GROUP_NAME}" status:solved updated<24hours`;
    const solvedResults = await paginatedZendeskSearch(solvedQuery, { maxPages: 5 });
    for (const t of solvedResults) {
      if (!seenZd.has(t.id)) { seenZd.add(t.id); allTickets.push(t); }
    }
    if (allTickets.length === 0) return { items: [], status: 'ok', count: 0, error: null };

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

    // Normalize tickets
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

      const activeAnchorMs = Math.max(requesterMs || 0, assignedMs || 0)
        || createdMs
        || null;
      const pausedAnchorMs = assigneeMs || updatedMs || createdMs || null;
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
        // Phase 2 — values for the 4 ops-hub-tracked Zendesk custom fields.
        // Detail.jsx renders these as editable selects; PUT through
        // /queue/[id]/custom-fields persists changes back to Zendesk.
        customFields,
        externalUrl: ZD_SUBDOMAIN
          ? `https://${ZD_SUBDOMAIN}.zendesk.com/agent/tickets/${t.id}`
          : '',
        tags: t.tags || [],
      };
    });

    return { items, status: 'ok', count: items.length, error: null };
  } catch (err) {
    console.error('[queue] Zendesk fetch error:', err.message);
    return { items: [], status: 'error', error: 'Zendesk fetch failed' };
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
        if (fetched >= MAX_ISSUES_PER_CLAUSE) break;
        if (++safetyPages >= MAX_PAGES) break;

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

    return { items, status: 'ok', count: items.length, error: null };
  } catch (err) {
    console.error('[queue] Jira fetch error:', err.message);
    return { items: [], status: 'error', error: 'Jira fetch failed' };
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

  const url = new URL(req.url);
  const bustCache = url.searchParams.has('_t');
  const source = url.searchParams.get('source'); // 'zendesk' | 'jira' | null (both)

  // ── Per-source fetch (new: independent sync per source) ───────────────────
  if (source === 'zendesk' || source === 'jira') {
    const cacheKey = `queue_${source}`;
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
      const fetched = source === 'zendesk' ? await fetchZendeskQueue() : await fetchJiraQueue();
      result = {
        source,
        items: fetched.items,
        meta: { count: fetched.count || 0, status: fetched.status, error: fetched.error },
        syncedAt: new Date().toISOString(),
      };
      cacheSet(cacheKey, result);
    } catch (fetchErr) {
      const stale = cacheGet(cacheKey, STALE_TTL);
      if (stale) {
        console.warn(`[queue/${source}] Fetch failed, returning stale:`, fetchErr.message);
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
  if (!bustCache) {
    const fresh = cacheGet(CACHE_KEY, CACHE_TTL);
    if (fresh) {
      return NextResponse.json({
        ...fresh,
        items: scopeQueueItems(fresh.items || [], user),
      });
    }
  }

  const stale = !bustCache ? cacheGet(CACHE_KEY, STALE_TTL) : null;

  let response;
  try {
    const [zendesk, jira] = await Promise.all([
      fetchZendeskQueue(),
      fetchJiraQueue(),
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
        zendesk: { count: zendesk.count || 0, status: zendesk.status, error: zendesk.error },
        jira:    { count: jira.count || 0,    status: jira.status,    error: jira.error },
        syncedAt: new Date().toISOString(),
        totalActive: items.filter(i => i.status !== 'resolved').length,
        totalResolved: items.filter(i => i.status === 'resolved').length,
      },
    };

    // Cache combined result only — per-source caches are populated independently
    // to avoid tripling memory usage by storing the same data 3x.
    cacheSet(CACHE_KEY, response);
  } catch (fetchErr) {
    if (stale) {
      console.warn('[queue] Fetch failed, returning stale cache:', fetchErr.message);
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

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
import { ADMIN_EMAILS_LIST } from '../../../../src/data/adminEmails';
import { cacheGet, cacheSet } from '../../../../src/lib/server-cache';
import { filterByAssignee } from '../../../../src/lib/queue-scoping';

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
async function paginatedZendeskSearch(query, { maxPages = 10, perPage = 100 } = {}) {
  const allResults = [];
  let page = 1;

  while (page <= maxPages) {
    const res = await searchTickets(query, { per_page: perPage, page, sort_by: 'updated_at', sort_order: 'desc' });
    const results = res?.results || [];
    allResults.push(...results);

    // Stop if we got fewer than perPage (last page) or no next_page
    if (results.length < perPage || !res?.next_page) break;
    page++;
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
    // Recently solved (last 4 hours) for transition detection — 1 page only
    const solvedQuery = `group:"${ZD_GROUP_NAME}" status:solved updated<4hours`;
    const solvedResults = await paginatedZendeskSearch(solvedQuery, { maxPages: 1 });
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

    // Normalize tickets
    const items = allTickets.map(t => {
      const assignee = userMap[t.assignee_id] || {};
      const requester = userMap[t.requester_id] || {};

      return {
        id: `ZD-${t.id}`,
        source: 'zendesk',
        externalId: String(t.id),
        subject: t.subject || '(no subject)',
        description: (t.description || '').substring(0, 200),
        status: ZD_STATUS_MAP[t.status] || 'new',
        priority: ZD_PRIORITY_MAP[t.priority] || 'medium',
        type: detectType(t.subject, t.tags || []),
        country: detectCountry(t.subject, t.tags || []),
        assigneeEmail: assignee.email || null,
        assigneeName: assignee.name || null,
        requesterName: requester.name || 'Unknown',
        requesterEmail: requester.email || null,
        lastCustomerResponseAt: t.updated_at, // Zendesk updated_at tracks last activity; this is a reasonable proxy
        createdAt: t.created_at,
        updatedAt: t.updated_at,
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
// ── Why we ALSO chunk the email IN-list (2026-04-23) ───────────────────────
// Previously we ran one query per role with ALL ~104 emails in a single IN
// clause, capped at 300 issues/clause. Across 104 people that cap is far
// below the actual volume of in-flight work, so the query truncated —
// always dropping the oldest-`updated` tickets first. That's exactly the
// CLIENT APPROVAL / EOR SIGNING / PRM REVIEW / "pending another team"
// buckets (they sit stale for weeks waiting on externals), so agents like
// Susana and Anne saw wildly under-counted queues ("84 expected, 15 shown").
// The fix: chunk ADMIN_EMAILS_LIST into groups small enough that each
// sub-query stays well under the 300 cap in typical team-wide volume.
// With EMAIL_CHUNK_SIZE=20 and a 300/clause cap, each agent's 15-50
// tickets comfortably fit whether they're freshly updated or months stale.
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
  // statusCategory is Jira's universal 3-value taxonomy (New/Indeterminate/
  // Done) that every custom status is mapped to — drops "Done: Work
  // Completed" and any other creative name without us maintaining a list.
  // Paired with resolution to also drop resolved-but-still-open-statuswise.
  const statusFilter = `statusCategory != Done AND (resolution IS EMPTY OR resolution = Unresolved)`;

  // Roles that can make a ticket "ours": primary assignee, reporter, plus
  // any HRX-owner custom fields discovered dynamically.
  const roleFields = ['assignee', 'reporter'];
  for (const cfId of Object.values(ownerFieldIds)) {
    if (!cfId) continue;
    const num = String(cfId).replace(/^customfield_/, '');
    roleFields.push(`cf[${num}]`);
  }

  // One query per (role × email-chunk). With 104 emails / 20-per-chunk = 6
  // chunks × 3 role fields = 18 sub-queries. Each is self-contained (own
  // status filter + ORDER BY) so per-clause pagination works normally and
  // fetchJiraQueue unions+dedups the results.
  const emailChunks = chunkArray(ADMIN_EMAILS_LIST, EMAIL_CHUNK_SIZE);
  const queries = [];
  for (const roleField of roleFields) {
    for (const chunk of emailChunks) {
      const emailsList = chunk.map(e => `"${e}"`).join(', ');
      queries.push(`${roleField} IN (${emailsList}) AND ${statusFilter} ORDER BY updated DESC`);
    }
  }
  return queries;
}

// ── Fetch Jira issues (paginated per clause, unioned) ──────────────────────
async function fetchJiraQueue() {
  if (!isJiraConfigured()) return { items: [], status: 'skipped', error: null };

  try {
    // Discover the HRX-owner custom field IDs once per hour (cached in
    // jira-api). If discovery fails the map is empty and we fall back to
    // assignee + reporter only — never breaks the queue.
    const ownerFieldIds = await resolveHrxOwnerFields(HRX_OWNER_FIELD_NAMES);
    const ownerFieldList = Object.values(ownerFieldIds);

    const jqlQueries = buildJiraJqlQueries(ownerFieldIds);
    const allIssues = [];
    const seenKeys = new Set();       // dedup across clauses — same key never lands twice
    const pageSize = 100;
    const MAX_ISSUES_PER_CLAUSE = 300; // safety cap per clause

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
      const ownerEmails = new Set();
      for (const cfId of Object.values(ownerFieldIds)) {
        if (!cfId) continue;
        const emails = emailsFromJiraFieldValue(f[cfId]);
        for (const e of emails) ownerEmails.add(e);
      }
      // Reporter also contributes to visibility — per Pilar's 2026-04-22 rule
      // ("pull any ticket if any of our users is the HRX Responsible or
      // Reporter"). Lowercased to match scoping's comparison convention.
      if (reporter.emailAddress) {
        ownerEmails.add(reporter.emailAddress.toLowerCase());
      }

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
        requesterName: reporter.displayName || 'System',
        requesterEmail: reporter.emailAddress || null,
        lastCustomerResponseAt: f.updated, // Jira updated tracks last activity
        createdAt: f.created,
        updatedAt: f.updated,
        // Jira SLA is fixed at 24h from the latest update regardless of the
        // inferred task type (Pilar's 2026-04-22 rule). slaInfo() in
        // src/utils/helpers.js reads this override before falling back to
        // SLA_MINS[type].
        slaMinsOverride: 1440,
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

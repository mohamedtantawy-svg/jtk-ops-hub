// ── Deel Admin API client ────────────────────────────────────────────────────
// Server-side only. Proxies calls to the Deel internal admin API.
// Base: https://api-prod-admin.letsdeel.com
// Auth: x-auth-token header (token from admin.deel.network Admin Debug Tool)
// Admin endpoints use /admin/... paths (NOT /rest/v2)
// Includes automatic retry with exponential backoff on transient failures.

import { withRetry } from './retry';

// ── Sanitize API key ─────────────────────────────────────────────────────────
function sanitizeToken(raw) {
  if (!raw) return '';
  let t = raw.trim().replace(/^["']+|["']+$/g, '');
  t = t.replace(/^Bearer\s+/i, '');
  t = t.replace(/[\r\n]+/g, '');
  return t;
}

const DEEL_API_KEY = sanitizeToken(process.env.DEEL_API_KEY || '');
// Optional: admin session JWT from admin.deel.network. Required for full
// pagination/filtering on /admin/* endpoints — the REST v2 API key does not
// accept params like `limit`, `cursor`, or `terminationFlowStatuses[]` there.
const DEEL_ADMIN_TOKEN = sanitizeToken(process.env.DEEL_ADMIN_TOKEN || '');

// ── Base URL ─────────────────────────────────────────────────────────────────
// Admin API at api-prod-admin.letsdeel.com — no path prefix needed,
// each function specifies the full path (/admin/eor/..., /rest/v2/..., etc.)
const DEEL_BASE = (process.env.DEEL_API_BASE_URL || 'https://api-prod-admin.letsdeel.com').replace(/\/+$/, '');

export function isDeelConfigured() {
  return !!DEEL_API_KEY;
}

/**
 * Return diagnostic info about the current Deel API configuration.
 */
export function getDeelDiagnostics() {
  return {
    configured: !!DEEL_API_KEY,
    baseUrl: DEEL_BASE,
    rawBaseEnv: process.env.DEEL_API_BASE_URL || '(not set, using default: api-prod-admin.letsdeel.com)',
    tokenPresent: DEEL_API_KEY.length > 0,
    // Intentionally omit token preview/length/type to avoid information disclosure
  };
}

/**
 * Raw fetch wrapper — no retry. Used internally.
 * Uses x-auth-token for admin API authentication.
 */
async function _deelFetch(path, options = {}) {
  if (!DEEL_API_KEY) {
    throw new Error('DEEL_API_KEY is not configured');
  }

  // For /admin/* paths, prefer DEEL_ADMIN_TOKEN (admin session JWT) if set —
  // /rest/v2/* endpoints keep using DEEL_API_KEY.
  const isAdminPath = path.startsWith('/admin/');
  const token = isAdminPath && DEEL_ADMIN_TOKEN ? DEEL_ADMIN_TOKEN : DEEL_API_KEY;

  const url = `${DEEL_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'x-auth-token': token,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Origin: 'https://admin.deel.network',
      Referer: 'https://admin.deel.network/',
      'x-app-host': 'app.deel.com',
      'x-proxy-to': 'payments',
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(20000),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const isS3Error = body.includes('<Error>') || body.includes('NoSuchBucket') || body.includes('Unsupported Authorization');
    const hint = isS3Error
      ? ` [CDN/S3 error — request to ${url} did not reach the Deel API. Check DEEL_API_BASE_URL env var.]`
      : '';
    const err = new Error(`Deel API ${res.status} @ ${url}: ${body.substring(0, 200)}${hint}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

/**
 * Deel API fetch with automatic retry.
 */
export async function deelFetch(path, options = {}) {
  return withRetry(() => _deelFetch(path, options), { label: 'Deel', maxRetries: 2 });
}

// ── People / Workers (REST v2 API) ──────────────────────────────────────────

export async function listPeople(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.search) qs.set('search', params.search);
  const q = qs.toString();
  return deelFetch(`/rest/v2/people${q ? `?${q}` : ''}`);
}

export async function getPersonByEmail(email) {
  return deelFetch(`/rest/v2/people?search=${encodeURIComponent(email)}`);
}

// ── Contracts (REST v2 API) ─────────────────────────────────────────────────

export async function listContracts(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.statuses) qs.set('statuses', params.statuses);
  if (params.types) qs.set('types', params.types);
  if (params.search) qs.set('search', params.search);
  const q = qs.toString();
  return deelFetch(`/rest/v2/contracts${q ? `?${q}` : ''}`);
}

export async function getContract(id) {
  return deelFetch(`/rest/v2/contracts/${id}`);
}

// ── Time Off (REST v2 API) ──────────────────────────────────────────────────

export async function listTimeOffRequests(params = {}) {
  const qs = new URLSearchParams();
  if (params.contract_id) qs.set('contract_id', params.contract_id);
  if (params.status) qs.set('status', params.status);
  if (params.limit) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return deelFetch(`/rest/v2/time-off${q ? `?${q}` : ''}`);
}

// ── Organization (REST v2 API) ──────────────────────────────────────────────

export async function getOrganization() {
  return deelFetch('/rest/v2/organizations/current');
}

// ── Onboarding (Admin API) ───────────────────────────────────────────────────

/**
 * Fetches onboarding actionable queue from the admin API.
 * Uses /admin/eor/employee-manager/list/Onboarding.ActionableQueue
 * — the same endpoint as admin.deel.network's onboarding dashboard.
 *
 * Response shape: { statuses: [...], result: [...tasks...], cursor: "..." }
 * Data is at res.result. Each task has: oid, employeeName, employmentCountry,
 * employeeNationality, desiredStartDate, onboardingFlowStep, tag, taskCreatedAt,
 * onboardingId, assignee, assigneeId, avatarUrl.
 *
 * Note: same employee can appear multiple times with different onboardingFlowStep.
 */
export async function listOnboardingPeople(params = {}) {
  const offset = params.offset || '0';
  const qs = `actionableQueueFilters%5Boffset%5D=${offset}`;
  const res = await deelFetch(`/admin/eor/employee-manager/list/Onboarding.ActionableQueue?${qs}`);

  const rawItems = res?.result || [];

  // Paginate through all pages using offset — cap at 300 items / 6 iterations
  let allItems = [...rawItems];
  let currentCursor = res?.cursor;
  let iterations = 0;
  while (currentCursor && iterations < 6 && allItems.length < 300) {
    iterations++;
    const nextRes = await deelFetch(`/admin/eor/employee-manager/list/Onboarding.ActionableQueue?actionableQueueFilters%5Boffset%5D=${allItems.length}`);
    const nextItems = nextRes?.result || [];
    if (nextItems.length === 0) break;
    allItems.push(...nextItems);
    currentCursor = nextRes?.cursor;
  }

  // Get the actionable queue total from the statuses tree
  const onboardingStatus = res?.statuses?.find(s => s.name === 'Onboarding');
  const actionableTotal = onboardingStatus?.actionableTasksTotal || allItems.length;

  const items = allItems.map(p => ({
    id:                p.onboardingId || p.oid || '',
    oid:               p.oid || '',                              // contract OID
    name:              p.employeeName || '',
    country:           p.employmentCountry || '',
    nationality:       p.employeeNationality || '',
    startDate:         p.desiredStartDate || '',
    createdAt:         p.createdAt || '',
    taskCreatedAt:     p.taskCreatedAt || '',
    flowStep:          p.onboardingFlowStep || '',               // e.g. "Onboarding.ComplianceDocs.AwaitingReview"
    tag:               p.tag || '',                              // e.g. "VIP EOR"
    avatarUrl:         p.avatarUrl || '',
    assignee:          p.assignee?.name || '',
    assigneeEmail:     p.assignee?.email || '',
    assigneeId:        p.assigneeId || null,
    isHourly:          p.timeTracking?.isHourly || false,
  }));

  return { items, total: actionableTotal, cursor: currentCursor || null };
}

// ── Paused Onboarding (Admin API) ─────────────────────────────────────────────

/**
 * Fetches paused onboarding contracts from the admin API.
 * Uses /admin/eor/employee-manager/list/Onboarding.EA.EASigning.Paused
 * Same response shape as ActionableQueue but with pauseType, statusTag fields.
 */
export async function listPausedOnboarding() {
  // Fetch the country summary to get all countries with paused contracts
  const countrySummary = await deelFetch('/admin/eor/employee-manager/countries/list/Onboarding.EA.EASigning.Paused');
  const countries = (Array.isArray(countrySummary) ? countrySummary : [])
    .filter(c => c.total > 0)
    .map(c => c.country);

  if (countries.length === 0) return { items: [], total: 0 };

  // Fetch per-country in parallel (the API scopes cursor per country,
  // so a single call without country filter only returns ~50 items).
  // Batch into groups of 5 to avoid hammering the API.
  const seen = new Set();
  const allItems = [];

  const BATCH_SIZE = 5;
  for (let i = 0; i < countries.length; i += BATCH_SIZE) {
    const batch = countries.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (ctry) => {
        try {
          const res = await deelFetch(
            `/admin/eor/employee-manager/list/Onboarding.EA.EASigning.Paused?countries%5B%5D=${ctry}`
          );
          return res?.result || [];
        } catch (err) {
          console.warn(`[pausedOnboarding] Failed for ${ctry}:`, err.message);
          return [];
        }
      })
    );
    for (const items of results) {
      for (const p of items) {
        const key = p.oid || p.onboardingId || '';
        if (key && seen.has(key)) continue;
        seen.add(key);
        allItems.push(p);
      }
    }
  }

  const items = allItems.map(p => ({
    id:                p.onboardingId || p.oid || '',
    oid:               p.oid || '',
    name:              p.employeeName || '',
    country:           p.employmentCountry || '',
    nationality:       p.employeeNationality || '',
    startDate:         p.desiredStartDate || '',
    createdAt:         p.createdAt || '',
    updatedAt:         p.updatedAt || '',                    // last update (best proxy for pause time)
    taskCreatedAt:     p.taskCreatedAt || '',               // when the task was created (NOT pause time)
    flowStep:          'Onboarding.EA.EASigning.Paused',
    pauseType:         p.pauseType || '',                    // REDLINE, MANUAL, AMENDMENT, OTHER
    statusTag:         p.statusTag || '',                    // e.g. "EA Redlined"
    tag:               p.tag || '',
    avatarUrl:         p.avatarUrl || '',
    assignee:          p.assignee?.name || '',
    assigneeEmail:     p.assignee?.email || '',
    assigneeId:        p.assigneeId || null,
  }));

  return { items, total: items.length };
}

// ── Offboarding / Terminations (Admin API) ──────────────────────────────────

// Mirrors the internal BI filter EXACTLY:
//   EOR Contracts Termination Status         IS NOT (COMPLETED, AWAITING_REFUND)
//   EOR Contracts Is Duplicate               IS NO
//   EOR Contracts Active Termination Step    IS NOT (Deposit refund step,
//                                                    Fee and adjustments step,
//                                                    Off cycle step,
//                                                    Cancelled)
// Plus top-level status not in (CANCELLED, DONE). Applied client-side so we
// don't depend on the admin API's bucket-name vocabulary, which diverges
// between the record-level `terminationFlowStatuses` array and the count
// object's bucket labels.

// Top-level statuses treated as closed / not actionable.
// User directive: exclude COMPLETED, DONE, CANCELLED.
const OFFBOARDING_CLOSED_STATUSES = new Set([
  'COMPLETED',
  'DONE',
  'CANCELLED',
  'CANCELED',
]);

// Only Deposit refund step is excluded from the flow array.
const OFFBOARDING_EXCLUDED_STEPS = new Set([
  'AwaitingDepositConfirmation', // BI label: "Deposit refund step"
]);

// Scan cap — the admin endpoint returns 50/page sorted by endDate ASC (nulls
// first), so ~200 pages covers every open record well past the ~900 expected.
const OFFBOARDING_MAX_PAGES = 200;

// Stop early once we've seen this many consecutive pages yielding 0 new
// matches. The sort front-loads actionable records, so once the BI filter
// stops producing keeps we've effectively exhausted the actionable set.
const OFFBOARDING_EMPTY_PAGE_STOP = 5;

function isOffboardingActionable(t) {
  const status = (t?.status || '').toUpperCase();
  if (OFFBOARDING_CLOSED_STATUSES.has(status)) return false;
  if (t.isDuplicate === true) return false;

  const flows = Array.isArray(t.terminationFlowStatuses) ? t.terminationFlowStatuses : [];
  if (flows.some(f => OFFBOARDING_EXCLUDED_STEPS.has(f))) return false;

  return true;
}

/**
 * Fetches all actionable EOR termination cases from the admin API.
 *
 * Strategy: paginate /admin/eor/terminations_v3 unfiltered (cursor loop),
 * apply the BI filter client-side for every record, dedupe by id.
 * The admin default sort is endDate ASC (nulls first) which front-loads
 * pre-finalized records; we early-stop after
 * OFFBOARDING_EMPTY_PAGE_STOP consecutive pages with 0 new keeps.
 *
 * BI filter applied here (see isOffboardingActionable):
 *   status NOT IN (COMPLETED, DONE, CANCELLED, AWAITING_REFUND)
 *   AND isDuplicate = false
 *   AND terminationFlowStatuses contains none of
 *       (FeeAndAdjustments, OffcycleInvoice, AwaitingDepositConfirmation)
 */
export async function listOffboardingCases() {
  const kept = [];
  const seen = new Set();
  let serverTotal = null;
  let page = 0;
  let scanned = 0;
  let emptyRun = 0;
  let mode = 'admin-scan';

  if (!DEEL_ADMIN_TOKEN) {
    // No admin JWT: the REST v2 token can't paginate /admin/* endpoints.
    // Fall back to single default page and apply the BI filter client-side.
    mode = 'rest-v2-fallback';
    const res = await deelFetch('/admin/eor/terminations_v3');
    serverTotal = res?.count?.total ?? null;
    for (const t of res?.terminations || []) {
      scanned++;
      if (seen.has(t.id)) continue;
      if (!isOffboardingActionable(t)) continue;
      seen.add(t.id);
      kept.push(t);
    }
    console.log(`[offboarding] mode=${mode}, scanned ${scanned}, kept ${kept.length} (server reports ${serverTotal} total)`);
  } else {
    // Admin JWT present: scan pages unfiltered, applying BI filter client-side.
    // The admin endpoint sorts by endDate ASC (nulls first), which front-loads
    // pre-finalized records — exactly what we care about. Stop when we've
    // seen OFFBOARDING_EMPTY_PAGE_STOP consecutive pages with zero new keeps.
    let cursor = null;
    for (; page < OFFBOARDING_MAX_PAGES; page++) {
      const qs = cursor ? `cursor=${encodeURIComponent(cursor)}` : 'limit=50';
      const res = await deelFetch(`/admin/eor/terminations_v3?${qs}`);
      if (serverTotal === null) serverTotal = res?.count?.total ?? null;

      let keptThisPage = 0;
      for (const t of res?.terminations || []) {
        scanned++;
        if (seen.has(t.id)) continue;
        if (!isOffboardingActionable(t)) continue;
        seen.add(t.id);
        kept.push(t);
        keptThisPage++;
      }

      if (keptThisPage === 0) emptyRun++; else emptyRun = 0;
      cursor = res?.cursor || null;
      if (!cursor) break;
      if (emptyRun >= OFFBOARDING_EMPTY_PAGE_STOP) {
        console.log(`[offboarding] early-stop: ${OFFBOARDING_EMPTY_PAGE_STOP} empty pages in a row at page ${page + 1}`);
        break;
      }
    }
    console.log(`[offboarding] mode=${mode}, pages=${page + 1}, scanned=${scanned}, kept=${kept.length} (server reports ${serverTotal} total open)`);
  }

  return kept.map(c => ({
    id: c.id,                                         // termination ID (e.g. 165810)
    contractId: c.eorContractId || c.contractOid || '',
    contractOid: c.contractOid || '',                 // short OID (e.g. "35jp4gq")
    name: c.name || '',
    email: c.email || '',
    country: c.employmentCountry || '',
    jobTitle: c.jobTitle || '',
    team: c.team || '',
    hiringType: c.type || 'eor',                     // top-level type: TERMINATION | RESIGNATION | ...
    startDate: c.startDate || '',
    endDate: c.endDate || '',                         // confirmed last working day (may be null)
    desiredEndDate: c.desiredEndDate || c.requestData?.desiredEndDate || '',
    originalEndDate: c.requestData?.originalEndDate || '',
    earliestEndDate: c.requestData?.earliestEndDate || '',
    isUrgentEndDate: c.requestData?.isUrgentEndDate === true,
    createdAt: c.createdAt || '',
    // Admin API doesn't return an `updatedAt` field on terminations; use the
    // latest timestamp we can derive so the "Updated" column isn't empty.
    updatedAt: c.updatedAt || c.requestData?.confirmedAt || c.requestData?.at || c.createdAt || '',
    status: c.status || '',                           // top-level lifecycle status
    organizationName: c.organizationName || '',       // client company name
    exAssignee: c.exAssignee || '',                   // assigned agent (name)
    exAssigneeId: c.exAssigneeId || null,
    exAssigneeEmail: c.exAssigneeEmail || '',
    clientSignOffStatus: c.clientSignOffStatus || '',
    employeeSignOffStatus: c.employeeSignOffStatus || '',
    terminationFlowStatuses: Array.isArray(c.terminationFlowStatuses) ? c.terminationFlowStatuses : [],
    reason: c.requestData?.reason || '',              // termination reason enum
    isResignation: c.requestData?.isEmployeeResignation || false,
    isMassTermination: c.requestData?.isMassTermination || false,
    jiraUrl: c.requestData?.jiraTicket?.jiraWebURL || '',
    noticePeriod: c.noticePeriod || 0,
    isArchived: c.isArchived || false,
    isDuplicate: c.isDuplicate === true,
    _serverTotal: serverTotal, // for diagnostics
  }));
}

// ── Contract Amendments (REST v2 API) ───────────────────────────────────────

export async function listAmendments(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.statuses) qs.set('statuses', params.statuses);
  const q = qs.toString();
  return deelFetch(`/rest/v2/contracts/amendments${q ? `?${q}` : ''}`);
}

// ── Invoices (REST v2 API) ──────────────────────────────────────────────────

export async function listInvoices(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.statuses) qs.set('statuses', params.statuses);
  const q = qs.toString();
  return deelFetch(`/rest/v2/invoices${q ? `?${q}` : ''}`);
}

// ── Redline Requests (Admin API) ────────────────────────────────────────────

/**
 * Fetches redline requests from the admin API.
 * Uses /admin/eor-experience/redline-requests — same as admin.deel.network.
 * Filters to "Preparing Documents → Legal Review" status.
 *
 * Response shape: { redlines: [...], cursor, totalCount }
 * Each redline has: id, status (IN_REVIEW), type (templateRedline/contractRedline),
 * creatorOrganization, template (with countryCode/countries), items[], participants[],
 * workbenchProcess with redlineLegalReviewTask details.
 */
export async function listRedlineRequests(params = {}) {
  const qs = new URLSearchParams();
  qs.set('sortBy', 'createdAt');
  qs.set('sortOrder', 'desc');
  qs.set('status', params.status || 'preparingDocuments.legalReview');
  qs.set('limit', String(params.limit || 200));
  const res = await deelFetch(`/admin/eor-experience/redline-requests?${qs.toString()}`);

  const rawItems = res?.redlines || [];

  const items = rawItems.map(r => ({
    id:                r.id || '',
    type:              r.type || '',                                  // templateRedline | contractRedline
    status:            r.status || '',                                // IN_REVIEW etc.
    createdAt:         r.createdAt || '',
    updatedAt:         r.updatedAt || '',
    orgName:           r.creatorOrganization?.name || '',
    orgId:             r.creatorOrganization?.id || '',
    countryCode:       r.template?.countryCode || '',
    countries:         r.template?.countries || [],                   // array of country names
    templateName:      r.template?.name || '',
    // Items — the actual redline changes requested
    changes:           (r.items || []).map(item => ({
      id:              item.id || '',
      requestedChange: item.itemSettings?.requestedChange || '',
      status:          item.status || '',
    })),
    changesCount:      (r.items || []).length,
    // Workbench task info
    workbenchStatus:   r.workbenchProcess?.redlineLegalReviewTask?.opsWorkbenchTask?.status || '',
    customStatusName:  r.workbenchProcess?.redlineLegalReviewTask?.opsWorkbenchTask?.customStatusName || '',
    assigneeId:        r.workbenchProcess?.redlineLegalReviewTask?.opsWorkbenchTask?.assigneeId || null,
    // Participants
    participants:      (r.participants || []).map(p => ({
      name:            p.name || '',
      role:            p.role || '',
      email:           p.email || '',
    })),
  }));

  return { items, total: res?.totalCount || items.length, cursor: res?.cursor || null };
}

// ── Amendment Requests (Admin API) ──────────────────────────────────────────

/**
 * Fetches amendment requests from the admin API.
 * Uses /admin/eor-experience/amendments-requests — same as admin.deel.network.
 * Filters to "Preparing Documents → Amendment Requested" and related statuses.
 *
 * Response shape: { filter: {...}, cursor, data: [...] }
 * Each amendment has: id, eorContractId, type (OPS/CUSTOM/LEGAL),
 * contract (with contractOid, employeeLegalName, employmentCountry),
 * items[] (dataPoint, previousValue, newValue), effectiveDate, amendmentStatuses[].
 */
export async function listAmendmentRequests(params = {}) {
  const qs = new URLSearchParams();
  qs.set('sortBy', 'createdAt');
  qs.set('sortOrder', 'desc');
  qs.set('statuses', params.statuses || 'PreparingDocuments.AmendmentRequested');
  qs.set('limit', String(params.limit || 200));
  const res = await deelFetch(`/admin/eor-experience/amendments-requests?${qs.toString()}`);

  const rawItems = res?.data || [];

  const items = rawItems.map(a => ({
    id:                a.id || '',
    eorContractId:     a.eorContractId || '',
    type:              a.type || '',                                  // OPS, CUSTOM, LEGAL
    contractOid:       a.contract?.contractOid || '',
    employeeName:      a.contract?.employeeLegalName || '',
    country:           a.contract?.employmentCountry || '',
    clientName:        a.contract?.clientLegalEntityName || a.contract?.organizationName || '',
    effectiveDate:     a.effectiveDate || '',
    createdAt:         a.createdAt || '',
    updatedAt:         a.updatedAt || '',
    // Amendment items — what's being changed
    changes:           (a.items || []).map(item => ({
      dataPoint:       item.dataPoint || '',
      label:           item.item || '',
      previousValue:   item.previousValue || '',
      newValue:        item.newValue || '',
    })),
    changesCount:      (a.items || []).length,
    // Statuses
    statuses:          (a.amendmentStatuses || []).map(s => ({
      status:          s.status || '',
      label:           s.label || '',
      updatedAt:       s.updatedAt || '',
    })),
    currentStatus:     (a.amendmentStatuses || []).find(s => s.status)?.status || '',
  }));

  return { items, total: items.length, cursor: res?.cursor || null };
}

// ── OpsWorkbench Tasks (Admin API) ─────────────────────────────────────────

/**
 * Fetches OpsWorkbench tasks from the admin API.
 * Uses /admin/ops_workbench/tasks — same endpoint as admin.deel.network.
 *
 * Query params:
 *   status[] — array of statuses: TO_DO, IN_PROGRESS, ON_HOLD, ESCALATED
 *   teamIds[] — array of team UUIDs (HRX Operations, HRX Termination)
 *   limit — max results per page (default 30)
 *
 * Response shape: { count: number, result: [...tasks...], cursor: string }
 * Each task has: id, name, description, status, country, assignee, creator,
 * createdAt, updatedAt, dueAt, slaTime, slaRemaining, slaBreachStatus,
 * taskConfiguration (name, sourceType, team), highPriority, contractOid, etc.
 */
export async function listWorkbenchTasks(params = {}) {
  const qs = new URLSearchParams();

  // Statuses to fetch (default: all actionable)
  const statuses = params.statuses || ['TO_DO', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED'];
  for (const s of statuses) qs.append('status[]', s);

  // HRX team IDs
  const teamIds = params.teamIds || [
    'f06e236b-85a2-4380-979f-f36acec498b4', // HRX Termination
    'f235fd21-c5a0-4804-badf-2cc3dc76191e', // HRX Operations
  ];
  for (const id of teamIds) qs.append('teamIds[]', id);

  qs.set('limit', String(params.limit || 200));

  const res = await deelFetch(`/admin/ops_workbench/tasks?${qs.toString()}`);
  const rawItems = res?.result || [];

  // Paginate: keep fetching until no cursor or safety cap of 300 items
  let allItems = [...rawItems];
  let cursor = res?.cursor;
  while (cursor && allItems.length < 300) {
    qs.set('cursor', cursor);
    const nextRes = await deelFetch(`/admin/ops_workbench/tasks?${qs.toString()}`);
    const nextItems = nextRes?.result || [];
    if (nextItems.length === 0) break;
    allItems.push(...nextItems);
    cursor = nextRes?.cursor;
  }

  const items = allItems.map(t => ({
    id:               t.id || '',
    name:             t.name || '',
    description:      t.description || '',
    status:           t.status || '',                              // TO_DO, IN_PROGRESS, etc.
    statusCategory:   t.customStatus?.statusCategory || t.status,
    country:          t.country || '',                             // 2-letter code
    assignee:         t.assignee ? { id: t.assignee.id, email: t.assignee.email, name: t.assignee.name } : null,
    creator:          t.creator ? { id: t.creator.id, email: t.creator.email, name: t.creator.name } : null,
    createdAt:        t.createdAt || '',
    updatedAt:        t.updatedAt || '',
    dueAt:            t.dueAt || null,
    completedAt:      t.completedAt || null,
    // SLA
    slaTime:          t.slaTime || null,                           // SLA window in seconds
    slaRemaining:     t.slaRemaining ?? null,                      // seconds remaining (use ?? to preserve 0)
    slaBreachStatus:  t.slaBreachStatus || '',                     // SLA_NOT_STARTED, SLA_NOT_BREACHED, SLA_PAUSED
    slaState:         t.slaState || '',                            // NOT_STARTED, RUNNING, PAUSED
    // Task type
    taskType:         t.taskConfiguration?.name || '',             // e.g. "HRX Escalation"
    sourceType:       t.taskConfiguration?.sourceType || '',       // e.g. "HRX_ESCALATION"
    teamName:         t.taskConfiguration?.team?.name || '',       // e.g. "HRX Operations"
    // Priority & refs
    highPriority:     t.highPriority || 0,
    contractOid:      t.contractOid || '',
    organizationId:   t.organizationId || null,
    origin:           t.origin || '',                              // NATS, PUBLIC_REQUEST, etc.
    // Escalation
    reasonForEscalation: t.reasonForEscalation || '',
    // Linked items
    jiraIssues:       t.jiraIssues || [],
    zendeskTickets:   t.zendeskTickets || [],
    escalations:      t.escalations || [],
  }));

  return { items, total: res?.count || items.length, cursor: cursor || null };
}

// ── Payslips (REST v2 API) ──────────────────────────────────────────────────

export async function getPayslips(contractId) {
  return deelFetch(`/rest/v2/contracts/${contractId}/payslips`);
}

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
  const keyLen = DEEL_API_KEY.length;
  const keyPreview = keyLen > 10 ? `${DEEL_API_KEY.substring(0, 6)}...${DEEL_API_KEY.substring(keyLen - 4)}` : '(too short)';
  return {
    configured: !!DEEL_API_KEY,
    baseUrl: DEEL_BASE,
    rawBaseEnv: process.env.DEEL_API_BASE_URL || '(not set, using default: api-prod-admin.letsdeel.com)',
    tokenLength: keyLen,
    tokenPreview: keyPreview,
    tokenLooksLikeJwt: DEEL_API_KEY.split('.').length === 3,
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

  const url = `${DEEL_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'x-auth-token': DEEL_API_KEY,
      Authorization: `Bearer ${DEEL_API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
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

  // Get the actionable queue total from the statuses tree
  const onboardingStatus = res?.statuses?.find(s => s.name === 'Onboarding');
  const actionableTotal = onboardingStatus?.actionableTasksTotal || rawItems.length;

  const items = rawItems.map(p => ({
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
    assigneeId:        p.assigneeId || null,
    isHourly:          p.timeTracking?.isHourly || false,
  }));

  return { items, total: actionableTotal, cursor: res?.cursor || null };
}

// ── Offboarding / Terminations (Admin API) ──────────────────────────────────

/**
 * Fetches AWAITING_TRIAGE termination cases from the admin API.
 * Uses /admin/eor/terminations_v3 — the same endpoint as admin.deel.network.
 * Filters to status=AWAITING_TRIAGE only (actionable items).
 *
 * NOTE: The endpoint does NOT accept "limit" or "cursor" as query params
 * (returns 400). It may accept filters via POST body or specific param names.
 * For now we call it without params and filter client-side.
 */
export async function listOffboardingCases() {
  // Call without query params — the endpoint rejects limit/cursor
  const res = await deelFetch('/admin/eor/terminations_v3');

  // Admin API returns { cursor, terminations: [...], count: { total, ... } }
  const dataArr = res?.terminations || [];

  // Filter to actionable items only: AWAITING_TRIAGE
  const actionable = dataArr.filter(c => {
    const status = (c.status || '').toUpperCase();
    return status === 'AWAITING_TRIAGE';
  });

  return actionable.map(c => ({
    id: c.id,                                         // termination ID (e.g. 165810)
    contractId: c.eorContractId || c.contractOid || '',
    contractOid: c.contractOid || '',                 // short OID (e.g. "35jp4gq")
    name: c.name || '',
    email: c.email || '',
    country: c.employmentCountry || '',
    jobTitle: c.jobTitle || '',
    team: c.team || '',
    hiringType: c.type || 'eor',                     // e.g. "TERMINATION"
    startDate: c.startDate || '',
    endDate: c.endDate || '',                         // last working day (may be null)
    desiredEndDate: c.desiredEndDate || '',
    createdAt: c.createdAt || '',
    updatedAt: c.updatedAt || '',
    status: c.status || '',                           // e.g. "AWAITING_TRIAGE"
    organizationName: c.organizationName || '',       // client company name
    exAssignee: c.exAssignee || '',                   // assigned agent
    reason: c.requestData?.reason || '',              // termination reason enum
    isResignation: c.requestData?.isEmployeeResignation || false,
    jiraUrl: c.requestData?.jiraTicket?.jiraWebURL || '',
    noticePeriod: c.noticePeriod || 0,
    isArchived: c.isArchived || false,
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

// ── Payslips (REST v2 API) ──────────────────────────────────────────────────

export async function getPayslips(contractId) {
  return deelFetch(`/rest/v2/contracts/${contractId}/payslips`);
}

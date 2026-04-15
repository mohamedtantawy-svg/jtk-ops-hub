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
 * Returns { items: [...normalized...], _raw: { topKeys, arrayKey, totalFromApi } }
 * so the route handler has both clean data and debug info.
 */
export async function listOnboardingPeople(params = {}) {
  const offset = params.offset || '0';
  const qs = `actionableQueueFilters%5Boffset%5D=${offset}`;
  const res = await deelFetch(`/admin/eor/employee-manager/list/Onboarding.ActionableQueue?${qs}`);

  // ── Auto-discover the data array ──────────────────────────────────────────
  // Admin API endpoints use different top-level keys. Try known names first,
  // then fall back to finding the first array property in the response.
  const topKeys = res ? Object.keys(res) : [];
  let rawItems = null;
  let arrayKey = null;

  // Try well-known keys
  const KNOWN_KEYS = ['data', 'rows', 'items', 'employees', 'people', 'records',
                       'actionableQueue', 'queue', 'onboardings', 'contracts', 'results'];
  for (const key of KNOWN_KEYS) {
    if (Array.isArray(res?.[key])) {
      rawItems = res[key];
      arrayKey = key;
      break;
    }
  }

  // Fallback: find first array value in response
  if (!rawItems && res && typeof res === 'object') {
    for (const [key, val] of Object.entries(res)) {
      if (Array.isArray(val) && val.length > 0) {
        rawItems = val;
        arrayKey = key;
        break;
      }
    }
  }

  // Last resort: response itself might be an array
  if (!rawItems && Array.isArray(res)) {
    rawItems = res;
    arrayKey = '(root)';
  }

  rawItems = rawItems || [];

  // ── Normalize each item ───────────────────────────────────────────────────
  // Admin API uses camelCase (like terminations). Try camelCase first, snake_case fallback.
  const items = rawItems.map(p => {
    const emp = p.employments?.[0] || p.employment || {};
    return {
      id:             p.id || p.contractId || p.eorContractId || p.contract_id || p.employee_id || '',
      name:           p.name || p.full_name || p.employee_name || p.worker_name || '',
      email:          p.email || p.worker_email || p.employee_email || '',
      country:        p.employmentCountry || p.country || emp.country || p.employment_country || '',
      countryName:    p.countryName || p.country_name || '',
      hiringStatus:   p.hiringStatus || p.hiring_status || p.status || p.onboarding_status || '',
      startDate:      p.startDate || p.start_date || emp.start_date || p.effective_date || '',
      jobTitle:       p.jobTitle || p.job_title || emp.job_title || p.position || '',
      hiringType:     p.hiringType || p.hiring_type || emp.hiring_type || p.contract_type || p.type || '',
      contractId:     p.contractOid || p.contractId || p.contract_id || emp.id || '',
      contractStatus: p.contractStatus || p.contract_status || emp.contract_status || '',
      team:           p.team || emp.team?.name || p.team_name || '',
      organizationName: p.organizationName || p.organization_name || '',
      exAssignee:     p.exAssignee || p.assignee || '',
    };
  });

  return {
    items,
    _raw: {
      topKeys,
      arrayKey,
      totalFromApi: res?.count?.total || res?.total || res?.page?.total || rawItems.length,
      firstItemKeys: rawItems[0] ? Object.keys(rawItems[0]) : [],
    },
  };
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

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
 * Fetches onboarding queue from the admin API.
 * Uses /admin/eor/employee-manager/list/Onboarding.ActionableQueue
 * — the same endpoint as admin.deel.network's onboarding dashboard.
 */
export async function listOnboardingPeople(params = {}) {
  const offset = params.offset || '0';
  const qs = `actionableQueueFilters%5Boffset%5D=${offset}`;
  return deelFetch(`/admin/eor/employee-manager/list/Onboarding.ActionableQueue?${qs}`);
}

// ── Offboarding / Terminations (Admin API) ──────────────────────────────────

/**
 * Fetches active EOR termination cases from the admin API.
 * Uses /admin/eor/terminations_v3 — the same endpoint as admin.deel.network.
 * Handles cursor-based pagination.
 */
export async function listOffboardingCases() {
  const PAGE_SIZE = 50;
  const allTerminations = [];
  let cursor = null;
  let page = 0;
  const MAX_PAGES = 20;

  while (page < MAX_PAGES) {
    const params = [`limit=${PAGE_SIZE}`];
    if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);

    const res = await deelFetch(`/admin/eor/terminations_v3?${params.join('&')}`);
    const items = res?.data || res?.rows || res || [];
    const dataArr = Array.isArray(items) ? items : (Array.isArray(res?.data) ? res.data : []);

    for (const c of dataArr) {
      allTerminations.push({
        contractId: c.contract_id || c.id || c.contractId,
        title: c.title || c.contract_title || '',
        name: c.worker_name || c.employee_name || c.full_name || c.name || '',
        email: c.worker_email || c.employee_email || c.email || '',
        terminationDate: c.termination_date || c.last_working_day || c.end_date || '',
        createdAt: c.created_at || c.request_date || '',
        updatedAt: c.updated_at || '',
        team: c.team || c.team_name || '',
        country: c.country || c.employment_country || c.country_name || '',
        jobTitle: c.job_title || c.position || '',
        hiringType: c.hiring_type || c.contract_type || 'eor',
        startDate: c.start_date || c.effective_date || '',
        noticePeriod: c.notice_period || 0,
        clientEmail: c.client_email || c.manager_email || '',
        creatorName: c.creator_name || c.requested_by || '',
        creatorEmail: c.creator_email || '',
        status: c.status || c.termination_status || '',
        isArchived: c.is_archived || false,
      });
    }

    // Handle pagination — look for cursor in various response shapes
    const nextCursor = res?.page?.cursor || res?.cursor || res?.next_cursor;
    if (!nextCursor || dataArr.length < PAGE_SIZE) break;
    cursor = nextCursor;
    page++;
  }

  return allTerminations;
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

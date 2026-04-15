// ── Deel Admin API client ────────────────────────────────────────────────────
// Server-side only. Proxies calls to the Deel REST API using the org's API token.
// Docs: https://developer.deel.com

const DEEL_API_KEY = process.env.DEEL_API_KEY || '';

// Normalize base URL — env var may or may not include /rest/v2
const _rawBase = (process.env.DEEL_API_BASE_URL || 'https://api.letsdeel.com').replace(/\/+$/, '');
const DEEL_BASE = _rawBase.endsWith('/rest/v2') ? _rawBase : `${_rawBase}/rest/v2`;

export function isDeelConfigured() {
  return !!DEEL_API_KEY;
}

/**
 * Generic fetch wrapper for Deel API.
 * Adds auth header, timeout, and JSON parsing.
 */
export async function deelFetch(endpoint, options = {}) {
  if (!DEEL_API_KEY) {
    throw new Error('DEEL_API_KEY is not configured');
  }

  const url = `${DEEL_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${DEEL_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Deel API ${res.status}: ${body.substring(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── People / Workers ─────────────────────────────────────────────────────────

export async function listPeople(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.search) qs.set('search', params.search);
  const q = qs.toString();
  return deelFetch(`/people${q ? `?${q}` : ''}`);
}

export async function getPersonByEmail(email) {
  return deelFetch(`/people?search=${encodeURIComponent(email)}`);
}

// ── Contracts ────────────────────────────────────────────────────────────────

export async function listContracts(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.statuses) qs.set('statuses', params.statuses);
  if (params.types) qs.set('types', params.types);
  if (params.search) qs.set('search', params.search);
  const q = qs.toString();
  return deelFetch(`/contracts${q ? `?${q}` : ''}`);
}

export async function getContract(id) {
  return deelFetch(`/contracts/${id}`);
}

// ── Time Off ─────────────────────────────────────────────────────────────────

export async function listTimeOffRequests(params = {}) {
  const qs = new URLSearchParams();
  if (params.contract_id) qs.set('contract_id', params.contract_id);
  if (params.status) qs.set('status', params.status);
  if (params.limit) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return deelFetch(`/time-off${q ? `?${q}` : ''}`);
}

// ── Organization ─────────────────────────────────────────────────────────────

export async function getOrganization() {
  return deelFetch('/organizations/current');
}

// ── Onboarding People ────────────────────────────────────────────────────────

export async function listOnboardingPeople(params = {}) {
  const qs = new URLSearchParams();
  // Fetch people in onboarding statuses
  const statuses = params.statuses || 'onboarding,onboarding_at_risk,onboarding_overdue,pending_invite';
  qs.set('hiring_statuses[]', statuses.split(',')[0]);
  // Deel API needs repeated params for arrays — build manually
  const statusArr = statuses.split(',');
  const limit = params.limit || '200';
  const offset = params.offset || '0';

  // Build URL with repeated hiring_statuses[] params
  const parts = statusArr.map(s => `hiring_statuses[]=${encodeURIComponent(s.trim())}`);
  parts.push(`limit=${limit}`);
  parts.push(`offset=${offset}`);
  // Request specific fields to keep payload small
  parts.push(...[
    'fields[]=' + encodeURIComponent('id'),
    'fields[]=' + encodeURIComponent('full_name'),
    'fields[]=' + encodeURIComponent('country'),
    'fields[]=' + encodeURIComponent('country_name'),
    'fields[]=' + encodeURIComponent('email'),
    'fields[]=' + encodeURIComponent('hiring_status'),
    'fields[]=' + encodeURIComponent('start_date'),
    'fields[]=' + encodeURIComponent('employments[0].id'),
    'fields[]=' + encodeURIComponent('employments[0].hiring_status'),
    'fields[]=' + encodeURIComponent('employments[0].new_hiring_status'),
    'fields[]=' + encodeURIComponent('employments[0].contract_status'),
    'fields[]=' + encodeURIComponent('employments[0].country'),
    'fields[]=' + encodeURIComponent('employments[0].start_date'),
    'fields[]=' + encodeURIComponent('employments[0].hiring_type'),
    'fields[]=' + encodeURIComponent('employments[0].job_title'),
    'fields[]=' + encodeURIComponent('employments[0].team'),
  ]);

  return deelFetch(`/people?${parts.join('&')}`);
}

// ── Contract Amendments ─────────────────────────────────────────────────────

export async function listAmendments(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.statuses) qs.set('statuses', params.statuses);
  const q = qs.toString();
  return deelFetch(`/contracts/amendments${q ? `?${q}` : ''}`);
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export async function listInvoices(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.statuses) qs.set('statuses', params.statuses);
  const q = qs.toString();
  return deelFetch(`/invoices${q ? `?${q}` : ''}`);
}

// ── Payslips ─────────────────────────────────────────────────────────────────

export async function getPayslips(contractId) {
  return deelFetch(`/contracts/${contractId}/payslips`);
}

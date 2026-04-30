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
    // Admin endpoints can take 10-20s per page under load. 20s was too tight
    // and produced intermittent "code 23" timeout retries during the scan loop.
    signal: options.signal || AbortSignal.timeout(40000),
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

// ── Internal-employee filter ────────────────────────────────────────────────
// Deel-internal employees ("Deelers") are tagged on their contract with the
// literal string "Deeler" in `contract.tags[]`. The HRX queues should not
// surface them — they're handled by an internal People Ops workflow, not the
// EOR workbench. Matching is case-insensitive and trimmed for robustness, but
// strict-equality on the token (no substring match — "Non-Deeler" or "Deelers"
// must not be filtered).
export function hasDeelerTag(tags) {
  if (!Array.isArray(tags)) return false;
  return tags.some(t => typeof t === 'string' && t.trim().toLowerCase() === 'deeler');
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

// Map a raw upstream onboarding row to the shape the rest of the app expects.
// Used by both the actionable-queue path and every per-status / per-country
// supplemental scan so every onboarding source emits the same fields.
function _mapOnboardingRow(p, flowStepOverride = null) {
  return {
    id:                p.onboardingId || p.oid || '',
    oid:               p.oid || '',                              // contract OID
    name:              p.employeeName || '',
    country:           p.employmentCountry || '',
    nationality:       p.employeeNationality || '',
    startDate:         p.desiredStartDate || '',
    createdAt:         p.createdAt || '',
    taskCreatedAt:     p.taskCreatedAt || '',
    flowStep:          flowStepOverride || p.onboardingFlowStep || '',
    tag:               p.tag || '',
    avatarUrl:         p.avatarUrl || '',
    assignee:          p.assignee?.name || '',
    assigneeEmail:     p.assignee?.email || '',
    assigneeId:        p.assigneeId || null,
    isHourly:          p.timeTracking?.isHourly || false,
    clientName:        p.organizationName || p.clientLegalEntityName || p.clientName || p.client?.name || '',
  };
}

// Per-country fan-out for an onboarding sub-status. The Deel admin API returns
// only ~50 rows per call without a country filter; the country-summary endpoint
// gives us the per-country totals so we can scope the follow-ups and pull
// every actionable row regardless of country. Mirrors the Paused onboarding
// pattern below.
async function _scanOnboardingByStatus(statusName, label) {
  let countrySummary;
  try {
    countrySummary = await deelFetch(
      `/admin/eor/employee-manager/countries/list/${encodeURIComponent(statusName)}`,
    );
  } catch (err) {
    console.warn(`[onboarding/${label}] countries summary failed:`, err.message);
    return [];
  }

  const countries = (Array.isArray(countrySummary) ? countrySummary : [])
    .filter(c => c && c.total > 0 && c.country)
    .map(c => c.country);

  if (countries.length === 0) return [];

  const BATCH_SIZE = 5;
  const collected = [];
  for (let i = 0; i < countries.length; i += BATCH_SIZE) {
    const batch = countries.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (ctry) => {
      try {
        const res = await deelFetch(
          `/admin/eor/employee-manager/list/${encodeURIComponent(statusName)}?countries%5B%5D=${ctry}`,
        );
        return res?.result || [];
      } catch (err) {
        console.warn(`[onboarding/${label}] ${ctry} failed:`, err.message);
        return [];
      }
    }));
    for (const items of results) collected.push(...items);
  }
  return collected;
}

// Onboarding sub-statuses we ALSO need to scan explicitly. These are
// actionable for HRX but historically did NOT all surface inside the
// `Onboarding.ActionableQueue` parent bucket — the team was missing real
// work. We scan them per-country and merge with the actionable-queue
// payload below; dedup happens on `onboardingId || oid`.
const SUPPLEMENTAL_ONBOARDING_STATUSES = [
  'Onboarding.EA.EAAdditionalDetails.AwaitingReview',
  'Onboarding.EA.EASigning.AwaitingToSendEA',
  'Onboarding.PayrollComplianceDetails.AwaitingReview',
  'Onboarding.ComplianceDocs.AwaitingReview',
];

/**
 * Fetches onboarding actionable queue from the admin API and supplements it
 * with per-status scans for the sub-statuses that the actionable-queue parent
 * bucket does not consistently surface (EA additional details review,
 * EA awaiting-to-send, payroll compliance review, compliance docs review).
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

  // Fan out the actionable-queue scan and the supplemental-status scans in
  // parallel so total wall time is bounded by the slowest of the two paths,
  // not their sum. Each branch self-handles failure; a flaky supplemental
  // status doesn't block the primary feed.
  const [actionableRes, supplementalRaw] = await Promise.all([
    deelFetch(`/admin/eor/employee-manager/list/Onboarding.ActionableQueue?${qs}`),
    Promise.all(SUPPLEMENTAL_ONBOARDING_STATUSES.map(name =>
      _scanOnboardingByStatus(name, name.split('.').slice(-2).join('.')),
    )),
  ]);

  const rawItems = actionableRes?.result || [];

  // Paginate through actionable-queue pages using offset — cap at 300 items / 6 iterations.
  let allItems = [...rawItems];
  let currentCursor = actionableRes?.cursor;
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
  const onboardingStatus = actionableRes?.statuses?.find(s => s.name === 'Onboarding');
  const actionableTotal = onboardingStatus?.actionableTasksTotal || allItems.length;

  // Map + dedup. Keep the actionable-queue version when both return the same
  // row, since its `onboardingFlowStep` is the canonical step the upstream
  // admin UI surfaces. Supplemental rows fill in only what was missing.
  const seen = new Set();
  const merged = [];
  for (const p of allItems) {
    const key = p.onboardingId || p.oid;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(_mapOnboardingRow(p));
  }
  for (let i = 0; i < SUPPLEMENTAL_ONBOARDING_STATUSES.length; i++) {
    const statusName = SUPPLEMENTAL_ONBOARDING_STATUSES[i];
    const rows = supplementalRaw[i] || [];
    for (const p of rows) {
      const key = p.onboardingId || p.oid;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // Stamp the flowStep when upstream omits it so the UI's per-status
      // labelling (deriveAction in route.js, function display in
      // normalizeSourceRows.js) still routes the row to the right copy.
      merged.push(_mapOnboardingRow(p, p.onboardingFlowStep || statusName));
    }
  }

  // Drop Deel-internal employees ("Deeler" tag on the contract). The upstream
  // onboarding row does NOT include contract.tags — we have to fetch the
  // contract by OID. Cached per OID for an hour and shared across feeds.
  const items = await dropDeelersByContractOid(merged, (it) => it.oid, 'onboarding');

  // Total now reflects the merged count, since the actionable-queue header
  // total only knows about its own bucket.
  return { items, total: Math.max(actionableTotal, items.length), cursor: currentCursor || null };
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

  const mapped = allItems.map(p => ({
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
    clientName:        p.organizationName || p.clientLegalEntityName || p.clientName || p.client?.name || '',
  }));

  // Drop Deel-internal employees ("Deeler" tag on the contract) — same rule
  // as the actionable queue. Resolves contract tags by OID.
  const items = await dropDeelersByContractOid(mapped, (it) => it.oid, 'paused-onboarding');

  return { items, total: items.length };
}

// ── Offboarding / Terminations (Admin API) ──────────────────────────────────

// Type+status matrix the team operates on (Pilar/Raquel spec, 2026-04-30):
//   Termination          → AWAITING_TRIAGE, PROCESSING
//   Resignation (Client) → AWAITING_TRIAGE, PROCESSING, AWAITING_HRX_ACTION
//   Resignation (Employee) → AWAITING_TRIAGE, PROCESSING, AWAITING_HRX_ACTION
//
// We attempted server-side filtering via `status[]=` but the Deel admin
// endpoint rejects that param shape with a Joi validation error
// (`"status" is not allowed`), so the filter MUST run client-side. We
// scan unfiltered and apply the matrix on each page.
const OFFBOARDING_TERMINATION_STATUSES = new Set([
  'AWAITING_TRIAGE',
  'PROCESSING',
]);
const OFFBOARDING_RESIGNATION_STATUSES = new Set([
  'AWAITING_TRIAGE',
  'PROCESSING',
  'AWAITING_HRX_ACTION',
]);

// Flow states treated as "past the actionable phase" — records dropped
// at ingestion so they don't land in the queue at all. Even if the upstream
// status is one of the actionable values above, a record that has already
// reached one of these flow steps is post-actionable for HRX (e.g. a
// PROCESSING termination already in the deposit-refund step).
const OFFBOARDING_EXCLUDED_STEPS = new Set([
  'AwaitingDepositConfirmation',   // "Deposit refund step"
  'AwaitingToAttachClientMethod',  // "Awaiting Payment Method"
  'AwaitingPendingItemsPayment',   // "Awaiting Pending Items Payment"
  'FeeAndAdjustments',             // "Fee and Adjustments"
  'OffcycleInvoice',               // "Off-Cycle Invoice"
]);

// Pagination cap — defensive ceiling so a runaway loop can't lock the
// request. With sortBy=createdAt&sort=DESC the actionable subset
// concentrates in the first ~50 pages (newest records); the long tail
// is dominated by old closed records (COMPLETED / CANCELLED / DONE)
// that the matrix filters out. The early-stop below kicks in well
// before this cap on a healthy upstream.
const OFFBOARDING_MAX_PAGES = 1000;

// Empty-page early-stop threshold. With createdAt-DESC the actionable
// subset is heavily front-loaded (recent records), so a long stretch of
// closed-only pages reliably means "we're past the actionable horizon".
// 200 is generous enough to absorb any cluster of recently-closed
// records before quitting; the wall-time saving vs walking the full
// 30k upstream is roughly 10x.
const OFFBOARDING_EMPTY_PAGE_STOP = 200;

function isOffboardingActionable(t) {
  if (t?.isDuplicate === true) return false;

  const status = (t?.status || '').toUpperCase();
  const isResignation = !!(t?.requestData?.isEmployeeResignation === true
    || (t?.type || '').toUpperCase().includes('RESIGNATION'));

  // Type+status matrix: Terminations are dropped from the AWAITING_HRX_ACTION
  // bucket per spec; Resignations keep all three statuses.
  if (isResignation) {
    if (!OFFBOARDING_RESIGNATION_STATUSES.has(status)) return false;
  } else {
    if (!OFFBOARDING_TERMINATION_STATUSES.has(status)) return false;
  }

  const flows = Array.isArray(t.terminationFlowStatuses) ? t.terminationFlowStatuses : [];
  if (flows.some(f => OFFBOARDING_EXCLUDED_STEPS.has(f))) return false;

  return true;
}

/**
 * Fetches all actionable EOR termination cases from the admin API.
 *
 * Strategy:
 *   1. First request sets `sortBy=createdAt&sort=DESC` so the cursor
 *      walks newest-first. The actionable subset (AWAITING_TRIAGE +
 *      PROCESSING + AWAITING_HRX_ACTION) is heavily concentrated in
 *      records created over the last few months — the older a
 *      termination, the more likely it's COMPLETED / CANCELLED.
 *   2. Apply the type+status matrix client-side per page. Track raw
 *      status counts as we go so the route handler can surface them
 *      to the UI ("here's what's in the upstream queue and what we
 *      filtered out").
 *   3. Early-stop after OFFBOARDING_EMPTY_PAGE_STOP consecutive pages
 *      with zero matrix hits — at that point we're deep in the
 *      already-closed long tail and continuing wastes round-trips.
 *
 * The previous strategy (default sort, no early-stop) was correct but
 * walked all ~600 pages every cache miss. createdAt-DESC + early-stop
 * gets us the same accuracy in ~10x less wall time.
 *
 * Per-type rules applied via isOffboardingActionable:
 *   Termination          → status in (AWAITING_TRIAGE, PROCESSING)
 *   Resignation (any)    → status in (AWAITING_TRIAGE, PROCESSING, AWAITING_HRX_ACTION)
 *   Plus: isDuplicate=false AND no excluded flow step.
 *
 * Returns: { items, statusCounts } so the route can include the
 * upstream breakdown alongside the filtered list. statusCounts is the
 * raw distribution across every record we scanned, useful for the
 * panel header ("X actionable of Y total open: A triage / B processing
 * / C HRX action").
 */
export async function listOffboardingCases() {
  const kept = [];
  const seen = new Set();
  const statusCounts = {};                  // raw upstream distribution
  let serverTotal = null;
  let page = 0;
  let scanned = 0;
  let emptyRun = 0;
  let mode = 'admin-scan';
  const startedAt = Date.now();
  const initialQs = 'limit=50&sortBy=createdAt&sort=DESC';

  function recordStatus(t) {
    const s = (t?.status || '').toUpperCase() || '_UNKNOWN';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  if (!DEEL_ADMIN_TOKEN) {
    // No admin JWT: the REST v2 token can't paginate /admin/* endpoints.
    // Fall back to single default page and apply the matrix client-side.
    mode = 'rest-v2-fallback';
    const res = await deelFetch(`/admin/eor/terminations_v3?${initialQs}`);
    serverTotal = res?.count?.total ?? null;
    for (const t of res?.terminations || []) {
      scanned++;
      recordStatus(t);
      if (seen.has(t.id)) continue;
      if (!isOffboardingActionable(t)) continue;
      seen.add(t.id);
      kept.push(t);
    }
    console.log(`[offboarding] mode=${mode}, scanned ${scanned}, kept ${kept.length} (server total=${serverTotal}, statuses=${JSON.stringify(statusCounts)})`);
  } else {
    // Admin JWT present: scan pages unfiltered (sorted createdAt DESC),
    // apply matrix client-side, early-stop on a long empty-page run.
    let cursor = null;
    for (; page < OFFBOARDING_MAX_PAGES; page++) {
      const qs = cursor ? `cursor=${encodeURIComponent(cursor)}` : initialQs;
      const res = await deelFetch(`/admin/eor/terminations_v3?${qs}`);
      if (serverTotal === null) serverTotal = res?.count?.total ?? null;

      let keptThisPage = 0;
      for (const t of res?.terminations || []) {
        scanned++;
        recordStatus(t);
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
    if (page >= OFFBOARDING_MAX_PAGES) {
      console.warn(`[offboarding] hit OFFBOARDING_MAX_PAGES (${OFFBOARDING_MAX_PAGES}) — may be missing records`);
    }
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[offboarding] mode=${mode}, pages=${page + 1}, scanned=${scanned}, kept=${kept.length}, elapsed=${elapsed}s (server total=${serverTotal}, statuses=${JSON.stringify(statusCounts)})`);
  }

  const mapped = kept.map(c => ({
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

  // Drop offboarding cases tied to Deel-internal employee contracts
  // ("Deeler" tag) — same rule as the rest of the queue feeds.
  const items = await dropDeelersByContractOid(mapped, (it) => it.contractOid || it.contractId, 'offboarding');

  // Return both the actionable items AND the raw upstream status
  // distribution so the route handler can surface "of N total open in
  // the upstream queue, M are actionable" to the panel header.
  return { items, statusCounts, serverTotal, scanned, pages: page + 1 };
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

// Pagination config: REDLINE_PAGE_SIZE items per call, follow cursor up to
// REDLINE_MAX_PAGES before bailing. 20 * 200 = 4000 item ceiling, well beyond
// current volume (~170 open at time of writing).
const REDLINE_MAX_PAGES = 20;
const REDLINE_PAGE_SIZE = 200;

async function fetchRedlinePage(status, cursor) {
  const qs = new URLSearchParams();
  qs.set('sortBy', 'createdAt');
  qs.set('sortOrder', 'desc');
  qs.set('status', status);
  qs.set('limit', String(REDLINE_PAGE_SIZE));
  if (cursor) qs.set('cursor', cursor);
  const res = await deelFetch(`/admin/eor-experience/redline-requests?${qs.toString()}`);
  return { items: res?.redlines || [], cursor: res?.cursor || null };
}

async function fetchAllRedlinesForStatus(status) {
  const all = [];
  let cursor = null;
  for (let page = 0; page < REDLINE_MAX_PAGES; page++) {
    const res = await fetchRedlinePage(status, cursor);
    all.push(...res.items);
    cursor = res.cursor;
    if (!cursor || res.items.length === 0) break;
  }
  return all;
}

// ── Shared contract-detail cache + helpers ────────────────────────────────
// Used by every queue feed that needs to read `contract.tags[]` to apply the
// Deeler filter (Onboarding, Paused Onboarding, Amendments, Redlines,
// Workbench, Offboarding). The Deel admin payloads don't carry contract tags
// inline on most rows — we have to fetch /admin/api/contract/{oid} to read
// them. The cache is shared across feeds so a contract referenced by both an
// amendment and a workbench task only round-trips once per hour.
const CONTRACT_DETAIL_CACHE = new Map();
const CONTRACT_DETAIL_TTL_MS = 60 * 60 * 1000;
const CONTRACT_DETAIL_CONCURRENCY = 5;

// Contract name format from Deel: "<Employee Legal Name> - <Job Title>".
// Split on the first " - " — job titles may themselves contain " - "
// (e.g. "Manager - EMEA"), but the employee name side doesn't.
function parseContractName(name) {
  if (!name) return '';
  const idx = name.indexOf(' - ');
  return idx > 0 ? name.slice(0, idx).trim() : name.trim();
}

// Fetch a contract detail object by OID. Returns the cached value if fresh.
// Returns null on error (caller falls back to "no detail available").
async function fetchContractDetail(contractOid) {
  if (!contractOid) return null;
  const key = String(contractOid);
  const hit = CONTRACT_DETAIL_CACHE.get(key);
  if (hit && Date.now() - hit.ts < CONTRACT_DETAIL_TTL_MS) return hit.detail;
  try {
    const c = await deelFetch(`/admin/api/contract/${encodeURIComponent(key)}`);
    const detail = {
      employeeName: parseContractName(c?.name),
      country:      c?.country || '',
      orgName:      c?.Team?.Organization?.name || '',
      contractOid:  c?.oid || c?.id || key,
      tags:         Array.isArray(c?.tags) ? c.tags : [],
    };
    CONTRACT_DETAIL_CACHE.set(key, { detail, ts: Date.now() });
    return detail;
  } catch (e) {
    return hit?.detail || null;
  }
}

// Bulk-resolve contract details for a set of OIDs. De-duplicates IDs and
// respects the global concurrency limit. Returns Map<oid, detail>.
async function resolveContractDetails(oids) {
  const unique = [...new Set(oids.filter(Boolean).map(String))];
  const resolved = new Map();
  for (let i = 0; i < unique.length; i += CONTRACT_DETAIL_CONCURRENCY) {
    const batch = unique.slice(i, i + CONTRACT_DETAIL_CONCURRENCY);
    const results = await Promise.all(batch.map(fetchContractDetail));
    batch.forEach((id, idx) => { if (results[idx]) resolved.set(id, results[idx]); });
  }
  return resolved;
}

// Drop items whose contract has the "Deeler" tag. `oidGetter(item)` returns
// the contract OID for that item (or falsy if the item isn't tied to a
// contract — e.g. template redlines, internal-tooling tasks). Items without
// a resolvable contract pass through unchanged: better to surface a real
// task we couldn't classify than to drop a customer task by mistake.
async function dropDeelersByContractOid(items, oidGetter, label) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const oids = items.map(oidGetter).filter(Boolean);
  if (oids.length === 0) return items;
  const details = await resolveContractDetails(oids);
  let dropped = 0;
  const kept = [];
  for (const item of items) {
    const oid = oidGetter(item);
    if (!oid) { kept.push(item); continue; }
    const detail = details.get(String(oid));
    if (detail && hasDeelerTag(detail.tags)) { dropped++; continue; }
    kept.push(item);
  }
  if (dropped > 0) {
    console.info(`[${label}] filtered ${dropped} Deeler contract(s) of ${items.length}`);
  }
  return kept;
}

async function enrichRedlines(items) {
  // Fetch contract detail for every contract redline (contractOid present)
  // — we need the detail both for missing display fields AND to drop
  // Deel-internal contracts ("Deeler" tag). Template redlines (no
  // contractOid) skip the fetch and the filter; they're not tied to an
  // employee.
  const oids = items.filter(i => i.contractOid).map(i => i.contractOid);
  if (oids.length === 0) return items;
  const resolved = await resolveContractDetails(oids);

  let droppedDeelers = 0;
  const out = [];
  for (const item of items) {
    if (!item.contractOid) { out.push(item); continue; }
    const detail = resolved.get(String(item.contractOid));
    if (detail && hasDeelerTag(detail.tags)) {
      droppedDeelers++;
      continue;
    }
    if (!detail) { out.push(item); continue; }
    out.push({
      ...item,
      employeeName: item.employeeName || detail.employeeName || '',
      countryCode:  item.countryCode  || detail.country      || '',
      orgName:      item.orgName      || detail.orgName      || '',
    });
  }
  if (droppedDeelers > 0) {
    console.info(`[redlines] filtered ${droppedDeelers} Deeler contract(s) of ${items.length}`);
  }
  return out;
}

/**
 * Fetches redline requests from the admin API.
 * Uses /admin/eor-experience/redline-requests — same as admin.deel.network.
 *
 * `status` may be a single string or an array — each value is fetched
 * independently (upstream API rejects comma/pipe-joined values) and merged.
 * Follows the `cursor` token to pull the full set (not just the first page).
 */
export async function listRedlineRequests(params = {}) {
  const statusList = Array.isArray(params.status)
    ? params.status
    : [params.status || 'preparingDocuments.legalReview'];

  const batches = await Promise.all(statusList.map(fetchAllRedlinesForStatus));

  // Dedupe by redline id (retry overlap guard).
  const seen = new Set();
  const rawItems = [];
  for (let i = 0; i < batches.length; i++) {
    for (const r of batches[i]) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      // Tag with the upstream status so the FE can split into sub-tabs even
      // when the payload itself doesn't carry a flow status.
      rawItems.push({ __status: statusList[i], ...r });
    }
  }

  const items = rawItems.map(r => {
    // Trust the upstream status bucket we fetched with — secondary signals
    // like `workbenchProcess.redlineExecutionTask` are unreliable because
    // review-bucket redlines pre-create an execution task in a pending state.
    const isExecution = /HRXToExecute/i.test(r.__status || '');
    // Derive redline type from the shape of the payload:
    //   - template redlines carry `templateToRefineId` / `template` + `creatorOrganization`
    //   - contract redlines carry `contractOid` / `contractName` / `employmentCountry`
    //     directly on the root object.
    const derivedType = r.type
                     || (r.templateToRefineId || r.template ? 'templateRedline'
                     :  r.contractOid ? 'contractRedline' : 'contractRedline');
    const wbReview = r.workbenchProcess?.redlineLegalReviewTask?.opsWorkbenchTask;
    const wbExec   = r.workbenchProcess?.redlineExecutionTask?.opsWorkbenchTask;
    const wbTask   = wbReview || wbExec || {};
    return {
      id:                r.id || '',
      type:              derivedType,
      status:            r.status || '',                                // IN_REVIEW / HRX_TO_EXECUTE
      createdAt:         r.createdAt || '',
      updatedAt:         r.updatedAt || '',
      // Organization — template redlines carry it on `creatorOrganization`;
      // contract redlines don't expose it on the redline payload, so we fall
      // back to the workbench task (rarely populated) and finally to the
      // /admin/api/contract/{oid} enrichment below.
      orgName:           r.creatorOrganization?.name
                      || wbTask.organization?.name
                      || wbTask.organizationName
                      || '',
      orgId:             r.creatorOrganization?.id
                      || wbTask.organizationId
                      || null,
      // Country — template redlines expose `template.countryCode`;
      // contract redlines expose `employmentCountry` at the root.
      countryCode:       r.template?.countryCode
                      || r.employmentCountry
                      || wbTask.country
                      || (r.template?.countries?.[0])
                      || '',
      countries:         r.template?.countries || [],
      templateName:      r.template?.name || '',
      // Employee — only contract redlines have one. The raw payload stores it
      // as `contractName` in "<Employee Name> - <Job Title>" format.
      employeeName:      parseContractName(r.contractName)
                      || (derivedType === 'contractRedline' ? wbTask.name : '')
                      || '',
      contractOid:       r.contractOid
                      || wbTask.contractOid
                      || '',
      isExecution,
      // Items — the actual redline changes requested
      changes:           (r.items || []).map(item => ({
        id:              item.id || '',
        requestedChange: item.itemSettings?.requestedChange || '',
        status:          item.status || '',
      })),
      changesCount:      (r.items || []).length,
      // Workbench process/task info — the admin UI deep-links by PROCESS id
      // (/ops-workbench-processes/{processId}), not the opsWorkbenchTask id.
      workbenchProcessId: r.workbenchProcessId || r.workbenchProcess?.id || '',
      workbenchTaskId:   wbTask.id || '',
      workbenchStatus:   wbTask.status || '',
      customStatusName:  wbTask.customStatusName || '',
      assigneeId:        wbTask.assigneeId || null,
      // Participants
      participants:      (r.participants || []).map(p => ({
        name:            p.name || '',
        role:            p.role || '',
        email:           p.email || '',
      })),
    };
  });

  const enriched = await enrichRedlines(items);
  return { items: enriched, total: enriched.length, cursor: null };
}

// ── Amendment Requests (Admin API) ──────────────────────────────────────────

// In-memory cache: eorContractId → { clientName, ts }. Client name rarely
// changes, so we cache for an hour and refresh opportunistically.
const AMEND_CLIENT_CACHE = new Map();
const AMEND_CLIENT_TTL_MS = 60 * 60 * 1000;
const AMEND_CLIENT_CONCURRENCY = 5;

async function fetchClientNameForContract(contractId) {
  if (!contractId) return '';
  const key = String(contractId);
  const hit = AMEND_CLIENT_CACHE.get(key);
  if (hit && Date.now() - hit.ts < AMEND_CLIENT_TTL_MS) return hit.clientName;
  try {
    const res = await deelFetch(`/rest/v2/contracts/${encodeURIComponent(key)}`);
    const c = res?.data || res || {};
    const clientName = c.client?.legal_name || c.client?.name || c.organization?.name
                    || c.client_legal_entity?.name || c.team?.name || '';
    AMEND_CLIENT_CACHE.set(key, { clientName, ts: Date.now() });
    return clientName;
  } catch (e) {
    return hit?.clientName || '';
  }
}

async function enrichClientNames(items) {
  const unique = [...new Set(items.map(i => i.eorContractId).filter(Boolean))];
  const resolved = new Map();
  for (let i = 0; i < unique.length; i += AMEND_CLIENT_CONCURRENCY) {
    const batch = unique.slice(i, i + AMEND_CLIENT_CONCURRENCY);
    const results = await Promise.all(batch.map(id => fetchClientNameForContract(id)));
    batch.forEach((id, idx) => resolved.set(String(id), results[idx] || ''));
  }
  return items.map(item => ({
    ...item,
    clientName: item.clientName || resolved.get(String(item.eorContractId)) || '',
  }));
}

/**
 * Resolve the most-specific meaningful status name for an amendment.
 * Rules:
 *   1. Prefer Paused.* sub-statuses (LegalReview, PausedByHRX, MobilityInput).
 *   2. Otherwise prefer the deepest admin-filter path (e.g. AmendmentRequested,
 *      WaitingHrxAction) over the parent "PreparingDocuments".
 */
function resolveCurrentStatus(amendmentStatuses = []) {
  const entries = amendmentStatuses.map(s => ({
    name: s.name || s.status || '',
    createdAt: s.AmendmentFlowStatus?.createdAt || s.updatedAt || '',
    showAdminFilter: s.showAdminFilter === true,
  }));
  const paused = entries.find(e => /^PreparingDocuments\.Paused\./.test(e.name));
  if (paused) return paused.name;
  const specific = entries
    .filter(e => e.showAdminFilter && e.name !== 'PreparingDocuments')
    .sort((a, b) => b.name.split('.').length - a.name.split('.').length)[0];
  if (specific) return specific.name;
  const anyAdmin = entries.find(e => e.showAdminFilter);
  return anyAdmin?.name || entries[0]?.name || '';
}

/**
 * Extract the timestamp when the amendment entered a Paused.* state, if any.
 */
function resolvePausedAt(amendmentStatuses = []) {
  const pausedEntries = amendmentStatuses
    .filter(s => /^PreparingDocuments\.Paused(\.|$)/.test(s.name || ''))
    .map(s => s.AmendmentFlowStatus?.createdAt || s.updatedAt || '')
    .filter(Boolean);
  if (pausedEntries.length === 0) return '';
  return pausedEntries.sort().pop();
}

/**
 * Fetches amendment requests from the admin API.
 * Uses /admin/eor-experience/amendments-requests — same as admin.deel.network.
 *
 * `statuses` may be a single string or an array. Each status is fetched in a
 * separate request (the upstream API doesn't accept multi-select); results are
 * merged and deduped by amendment id.
 *
 * Each amendment is enriched with clientName by looking up the contract detail
 * (cached in-memory for an hour).
 */
export async function listAmendmentRequests(params = {}) {
  const statuses = Array.isArray(params.statuses)
    ? params.statuses
    : [params.statuses || 'PreparingDocuments.AmendmentRequested'];

  async function fetchStatus(status) {
    const qs = new URLSearchParams();
    qs.set('sortBy', 'createdAt');
    qs.set('sortOrder', 'desc');
    qs.set('statuses', status);
    qs.set('limit', String(params.limit || 200));
    const res = await deelFetch(`/admin/eor-experience/amendments-requests?${qs.toString()}`);
    return res?.data || [];
  }

  const batches = await Promise.all(statuses.map(fetchStatus));

  // Merge + dedupe by amendment id (same amendment never appears twice in one
  // bucket, but a retry could in theory return overlap).
  const seen = new Set();
  const rawItems = [];
  for (const batch of batches) {
    for (const a of batch) {
      if (!a?.id || seen.has(a.id)) continue;
      seen.add(a.id);
      rawItems.push(a);
    }
  }

  const items = rawItems.map(a => {
    const currentStatus = resolveCurrentStatus(a.amendmentStatuses);
    const pausedAt = resolvePausedAt(a.amendmentStatuses);
    return {
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
      clientConfirmedAt: a.changeRequest?.clientConfirmedAt || '',
      pausedAt,
      isPaused:          /^PreparingDocuments\.Paused(\.|$)/.test(currentStatus),
      // Amendment items — what's being changed
      changes:           (a.items || []).map(item => ({
        dataPoint:       item.dataPoint || '',
        label:           item.item || '',
        previousValue:   item.previousValue || '',
        newValue:        item.newValue || '',
      })),
      changesCount:      (a.items || []).length,
      // Raw statuses (kept for diagnostics)
      statuses:          (a.amendmentStatuses || []).map(s => ({
        name:            s.name || '',
        friendlyName:    s.friendlyName || '',
        showAdminFilter: s.showAdminFilter === true,
        updatedAt:       s.AmendmentFlowStatus?.createdAt || s.updatedAt || '',
      })),
      currentStatus,
    };
  });

  const enriched = await enrichClientNames(items);
  // Drop amendments whose contract has the "Deeler" tag. The amendment
  // payload's `a.contract` may carry tags inline, but we don't trust that
  // path — we resolve via the same /admin/api/contract/{oid} endpoint as
  // the redline pipeline so the rule is uniform across feeds.
  const filtered = await dropDeelersByContractOid(enriched, (it) => it.contractOid, 'amendments');
  return { items: filtered, total: filtered.length, cursor: null };
}

// ── OpsWorkbench Tasks (Admin API) ─────────────────────────────────────────

// HRX Operations team — the only team the Workbench Q surfaces. HRX
// Termination tasks live under a different team ID and are surfaced in the
// Offboarding panel instead.
export const HRX_OPERATIONS_TEAM_ID = 'f235fd21-c5a0-4804-badf-2cc3dc76191e';

const WORKBENCH_PAGE_SIZE = 200;
const WORKBENCH_MAX_PAGES = 25; // 25 * 200 = 5000 item ceiling (well above current volume)

// Country is frequently null on the task itself but carried in a custom
// field keyed by reference "COUNTRY..." as either a dropdown string or a
// multi-select array (e.g. ["Turkey"]). Return the first populated one —
// FE helpers (getFlag / getCountryName) accept both ISO2 and full names.
function extractCountryFromCustomFields(customFields) {
  if (!Array.isArray(customFields) || customFields.length === 0) return '';
  for (const f of customFields) {
    const ref = (f?.reference || '').toUpperCase();
    if (!ref.includes('COUNTR')) continue;
    const multi = f.dropdownMultiSelectValue;
    if (Array.isArray(multi) && multi.length > 0 && multi[0]) return String(multi[0]);
    if (Array.isArray(f.value) && f.value.length > 0 && f.value[0]) return String(f.value[0]);
    if (typeof f.value === 'string' && f.value) return f.value;
  }
  return '';
}

/**
 * Fetches OpsWorkbench tasks from the admin API.
 * Uses /admin/ops_workbench/tasks — same endpoint as admin.deel.network.
 *
 * Defaults:
 *   - teamIds: HRX Operations only
 *   - statuses: all four actionable buckets (TO_DO, IN_PROGRESS, ON_HOLD, ESCALATED)
 *   - follows `cursor` across pages up to 5000 items
 */
export async function listWorkbenchTasks(params = {}) {
  const statuses = params.statuses || ['TO_DO', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED'];
  const teamIds = params.teamIds || [HRX_OPERATIONS_TEAM_ID];
  // Whether to also pull recently-completed tasks. Default ON so the queue
  // and Briefing's "resolved today" count includes Workbench tasks closed
  // in the last 24h — matches the cross-queue spec ("always show resolved
  // items in the past 24h with no data loss across all Qs"). Caller can
  // disable for endpoints that only care about the active backlog.
  const includeCompleted = params.includeCompleted !== false;
  const completedLookbackMs = (params.completedLookbackHours ?? 24) * 60 * 60 * 1000;

  const buildQs = (cursor, statusList) => {
    const qs = new URLSearchParams();
    for (const s of statusList) qs.append('status[]', s);
    for (const id of teamIds) qs.append('teamIds[]', id);
    qs.set('limit', String(params.limit || WORKBENCH_PAGE_SIZE));
    if (cursor) qs.set('cursor', cursor);
    return qs;
  };

  const allItems = [];
  let cursor = null;
  let serverCount = 0;
  for (let page = 0; page < WORKBENCH_MAX_PAGES; page++) {
    const qs = buildQs(cursor, statuses);
    const res = await deelFetch(`/admin/ops_workbench/tasks?${qs.toString()}`);
    const pageItems = res?.result || [];
    serverCount = res?.count || serverCount;
    if (pageItems.length === 0) break;
    allItems.push(...pageItems);
    cursor = res?.cursor || null;
    if (!cursor) break;
  }

  // Recently-completed tasks — bounded by `completedLookbackHours` (24h
  // default) so the upstream call stays cheap. Fetch one page of COMPLETED
  // ordered by completedAt desc, post-filter by timestamp. Items already in
  // `allItems` (transitioning) are deduped by id below in the mapper.
  if (includeCompleted) {
    try {
      const qs = buildQs(null, ['COMPLETED']);
      const res = await deelFetch(`/admin/ops_workbench/tasks?${qs.toString()}`);
      const pageItems = res?.result || [];
      const cutoff = Date.now() - completedLookbackMs;
      const seen = new Set(allItems.map(t => t.id));
      let kept = 0;
      for (const t of pageItems) {
        if (seen.has(t.id)) continue;
        const ts = t.completedAt ? new Date(t.completedAt).getTime() : 0;
        if (!ts || ts < cutoff) continue;
        allItems.push(t);
        seen.add(t.id);
        kept++;
      }
      if (kept > 0) console.info(`[workbench] kept ${kept} recently-completed task(s) (last ${completedLookbackMs / 3600000}h)`);
    } catch (err) {
      console.warn('[workbench] recently-completed fetch failed (non-fatal):', err.message);
    }
  }

  const items = allItems.map(t => ({
    id:               t.id || '',
    name:             t.name || '',
    description:      t.description || '',
    status:           t.status || '',                              // TO_DO, IN_PROGRESS, etc.
    statusCategory:   t.customStatus?.statusCategory || t.status,
    // Country: prefer top-level; fall back to the custom-field scan.
    country:          t.country
                   || extractCountryFromCustomFields(t.taskConfiguration?.customFieldConfigurations)
                   || '',
    assignee:         t.assignee ? { id: t.assignee.id, email: t.assignee.email, name: t.assignee.name } : null,
    // Flat alias so queue-scoping.js (which reads item.assigneeEmail) can
    // match the assignee chain. Without this the workbench scope falls
    // through to the country-owner path for every task — broader than the
    // team spec, which calls for assignee-only on Workbench.
    assigneeEmail:    t.assignee?.email || '',
    creator:          t.creator ? { id: t.creator.id, email: t.creator.email, name: t.creator.name } : null,
    createdAt:        t.createdAt || '',
    updatedAt:        t.updatedAt || '',
    dueAt:            t.dueAt || null,
    completedAt:      t.completedAt || null,
    // SLA
    slaTime:          t.slaTime || null,                           // SLA window in seconds
    slaRemaining:     t.slaRemaining ?? null,                      // seconds remaining (?? preserves 0)
    slaBreachStatus:  t.slaBreachStatus || '',                     // SLA_NOT_STARTED, SLA_NOT_BREACHED, SLA_PAUSED
    slaState:         t.slaState || '',                            // NOT_STARTED, RUNNING, PAUSED
    // Task type
    taskType:         t.taskConfiguration?.name || '',             // e.g. "Expedite EOR Onboarding"
    sourceType:       t.taskConfiguration?.sourceType || '',
    teamName:         t.taskConfiguration?.team?.name || '',       // e.g. "HRX Operations"
    teamId:           t.taskConfiguration?.team?.id || '',
    // Priority & refs
    highPriority:     t.highPriority || 0,
    contractOid:      t.contractOid || '',
    organizationId:   t.organizationId || null,
    origin:           t.origin || '',
    // Escalation
    reasonForEscalation: t.reasonForEscalation || '',
    // Linked items
    jiraIssues:       t.jiraIssues || [],
    zendeskTickets:   t.zendeskTickets || [],
    escalations:      t.escalations || [],
  }));

  // Drop workbench tasks tied to Deel-internal employee contracts ("Deeler"
  // tag). Tasks without a contractOid (e.g. internal tooling work) pass
  // through — they're not employee-bound. Filtering happens AFTER the page
  // pull so the upstream count isn't affected; the route handler reports
  // the post-filter total to the UI.
  const filtered = await dropDeelersByContractOid(items, (it) => it.contractOid, 'workbench');

  return { items: filtered, total: filtered.length, cursor: null };
}

// ── Payslips (REST v2 API) ──────────────────────────────────────────────────

export async function getPayslips(contractId) {
  return deelFetch(`/rest/v2/contracts/${contractId}/payslips`);
}

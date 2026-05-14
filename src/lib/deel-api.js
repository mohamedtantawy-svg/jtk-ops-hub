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
    if (res.status === 429) {
      // Deel admin API sends Retry-After in seconds when it throttles.
      // Forward to withRetry so the backoff matches the upstream cool-down.
      // Clamped to 60 s at the parser (defence-in-depth; withRetry caps too).
      const RETRY_AFTER_PARSE_MAX_MS = 60_000;
      const ra = res.headers.get('Retry-After');
      if (ra) {
        let parsedMs = null;
        const asSec = Number(ra);
        if (Number.isFinite(asSec) && asSec >= 0) {
          parsedMs = Math.round(asSec * 1000);
        } else {
          const parsed = Date.parse(ra);
          if (Number.isFinite(parsed)) {
            parsedMs = Math.max(0, parsed - Date.now());
          }
        }
        if (parsedMs !== null) {
          err.retryAfterMs = Math.min(parsedMs, RETRY_AFTER_PARSE_MAX_MS);
        }
      }
    }
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

// Deeler-tag filter removed 2026-05-04 — internal Deel employees on contracts
// tagged "Deeler" now surface in HRX queues alongside customer employees so
// the platform totals match Ops Hub. Previously the silent strip created a
// 64-vs-52 gap on Incentive Plans (and the same shape on every other feed),
// which made source-picker counts disagree with the Deel admin source-of-
// truth. Helper `hasDeelerTag` and `dropDeelersByContractOid` removed.

/**
 * Deel API fetch with automatic retry.
 */
export async function deelFetch(path, options = {}) {
  return withRetry(() => _deelFetch(path, options), { label: 'Deel', maxRetries: 2 });
}

// REST v2 list/single wrappers (listPeople, listContracts, listTimeOffRequests,
// getOrganization) were removed 2026-05-13 — `/rest/v2/people` + `/contracts`
// list endpoints had been 401-ing for weeks (~240 errors / 3h in prod logs)
// and `/time-off` + `/organizations/current` were 404 (endpoints retired by
// upstream). The only consumers were diagnostic tiles on Briefing + a Team
// caption — none of the queue / HR Hub / OOO surfaces depended on them.
// fetchClientNameForContract below still uses `/rest/v2/contracts/<id>`
// (single-resource) for amendment + onboarding client-name enrichment, which
// continues to work with the current DEEL_API_KEY scope.

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

  // Concurrency cap on the country fan-out. Was 5, dropped to 3 after the
  // 2026-05-08 logs showed Deel admin returning 429s during peak when the
  // 4 supplemental sub-statuses fan out in parallel (4 × 5 = 20 concurrent
  // admin calls — too many even for the per-minute Enterprise limit).
  // 3 keeps the worst case at 4 × 3 = 12 concurrent. Combined with the
  // 100 ms inter-batch sleep below, peak rate stays comfortably under
  // limit. The Retry-After-aware retry in src/lib/retry.js (PR #497)
  // is the safety net for any 429 that still slips through.
  const BATCH_SIZE = 3;
  // 2026-05-11 audit: 100 ms left the per-status burst window too tight,
  // contributing to the Deel 429 storm right after the fresh-pod boot.
  // Bumping to 250 ms spreads each 3-call batch over a wider window
  // (single supplemental status now caps out at ~12 calls/sec instead of
  // ~30 calls/sec) without meaningfully changing total wall time given
  // that the outer loop is now sequential.
  const INTER_BATCH_DELAY_MS = 250;
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
    if (i + BATCH_SIZE < countries.length) {
      await new Promise(r => setTimeout(r, INTER_BATCH_DELAY_MS));
    }
  }
  return collected;
}

// Sub-statuses we ALSO need to scan explicitly. These are actionable for
// HRX but historically did NOT all surface inside the
// `Onboarding.ActionableQueue` parent bucket — the team was missing real
// work. We scan them per-country and merge with the actionable-queue
// payload below; dedup happens on `onboardingId || oid`.
//
// The `Active.*` mirrors were added 2026-05-14 after Celine reported that
// `Active.ComplianceDocs.AwaitingReview` (currently-employed compliance
// review, e.g. VN 2026-05-12) had 3 cases visible in the Deel admin's
// Active tab but 0 in the Ops Hub Onboarding section. Same flow steps,
// different lifecycle root: Onboarding.* covers pre-start hires; Active.*
// covers in-employment actions on existing employees. The flow-step
// parser in `normalizeSourceRows.js` strips the root segment so both
// surface as the same friendly "Compliance Docs · Awaiting Review" label;
// `_mapOnboardingRow` is lifecycle-agnostic and works on either shape.
// Statuses that don't exist upstream (if any) fail through the existing
// try/catch in `_scanOnboardingByStatus` and contribute zero rows.
const SUPPLEMENTAL_ACTIONABLE_STATUSES = [
  'Onboarding.EA.EAAdditionalDetails.AwaitingReview',
  'Onboarding.EA.EASigning.AwaitingToSendEA',
  'Onboarding.PayrollComplianceDetails.AwaitingReview',
  'Onboarding.ComplianceDocs.AwaitingReview',
  'Active.EA.EAAdditionalDetails.AwaitingReview',
  'Active.EA.EASigning.AwaitingToSendEA',
  'Active.PayrollComplianceDetails.AwaitingReview',
  'Active.ComplianceDocs.AwaitingReview',
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

  // Fan out the actionable-queue scan in parallel with the supplemental
  // status scans. The supplemental scans themselves run SEQUENTIALLY — each
  // status already does its own 3-at-a-time country fan-out, and running
  // four of those concurrently created a compound 4×3 = 12 peak concurrent
  // calls that was the dominant cause of the 2026-05-11 Deel 429 burst
  // (live logs showed sustained 429s on `/admin/eor/employee-manager/list/
  // Onboarding.EA.EASigning.Paused?countries[]=...` across GB / AL / AM /
  // AE / ... within the same second). Sequential outer keeps peak at
  // 1 (actionable) + 3 (one inner batch) = 4 concurrent, well inside the
  // upstream's tolerance. Wall time grows from max-of-4 to sum-of-4 (~4×
  // longer for the supplemental branch only), still bounded by the slower
  // actionable scan in the common case. Skill mistake #41.
  const supplementalSequential = async () => {
    const out = [];
    for (const name of SUPPLEMENTAL_ACTIONABLE_STATUSES) {
      const items = await _scanOnboardingByStatus(
        name,
        name.split('.').slice(-2).join('.'),
      );
      out.push(items);
    }
    return out;
  };
  const [actionableRes, supplementalRaw] = await Promise.all([
    deelFetch(`/admin/eor/employee-manager/list/Onboarding.ActionableQueue?${qs}`),
    supplementalSequential(),
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
  for (let i = 0; i < SUPPLEMENTAL_ACTIONABLE_STATUSES.length; i++) {
    const statusName = SUPPLEMENTAL_ACTIONABLE_STATUSES[i];
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

  // Deeler-tag filter removed 2026-05-04 — internal Deel employees now
  // surface in HRX queues alongside customer employees so the platform
  // count and Ops Hub agree (previously the silent strip created a 64-vs-52
  // gap on Incentive Plans, identical pattern on every other feed).

  // Enrich missing client names via the per-contract REST v2 lookup. The
  // upstream actionable-queue row does NOT include `organizationName` for
  // most rows — the 2026-05-03 live audit (F9) found 100% of 330 onboarding
  // rows showed Organization = `--` because every fallback path returned
  // empty. Mirror the amendments fix at fetchClientNameForContract +
  // enrichClientNames(): batched (concurrency 5) lookups by `oid`, 1h
  // in-memory cache. Items already carrying clientName from the upstream
  // payload are skipped to avoid an unnecessary contract hit.
  const items = await _enrichOnboardingClientNames(merged);

  // Total now reflects the merged count, since the actionable-queue header
  // total only knows about its own bucket.
  return { items, total: Math.max(actionableTotal, items.length), cursor: currentCursor || null };
}

// Enrich onboarding rows with `clientName` via per-contract REST v2 lookup.
// Mirrors enrichClientNames() (used by amendments) but keys off `oid` rather
// than `eorContractId`. Idempotent: rows that already carry a non-empty
// clientName are skipped. The shared AMEND_CLIENT_CACHE is reused so the
// same contract OID seen across amendments / onboarding only hits upstream
// once per hour.
async function _enrichOnboardingClientNames(items) {
  const needsLookup = items.filter(i => !i.clientName && i.oid);
  if (needsLookup.length === 0) return items;
  const unique = [...new Set(needsLookup.map(i => i.oid))];
  const resolved = new Map();
  for (let i = 0; i < unique.length; i += AMEND_CLIENT_CONCURRENCY) {
    const batch = unique.slice(i, i + AMEND_CLIENT_CONCURRENCY);
    const results = await Promise.all(batch.map(id => fetchClientNameForContract(id)));
    batch.forEach((id, idx) => resolved.set(String(id), results[idx] || ''));
  }
  return items.map(item => ({
    ...item,
    clientName: item.clientName || resolved.get(String(item.oid)) || '',
  }));
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
  // BATCH_SIZE was 5; dropped to 3 after 2026-05-08 logs showed Deel
  // admin 429-ing on SN, ZA, etc when this fan-out overlapped with the
  // supplemental-onboarding scans (each also batching 3-5 concurrent).
  // 100 ms inter-batch sleep spreads load further. Retry-After-aware
  // retry in src/lib/retry.js (PR #497) is the safety net.
  const seen = new Set();
  const allItems = [];

  const BATCH_SIZE = 3;
  // Bumped 100 → 250 ms on 2026-05-11 in lockstep with the supplemental
  // onboarding scan — the two fan-outs overlap on the first poll cycle
  // after boot, so tightening either alone wasn't enough.
  const INTER_BATCH_DELAY_MS = 250;
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
    if (i + BATCH_SIZE < countries.length) {
      await new Promise(r => setTimeout(r, INTER_BATCH_DELAY_MS));
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

  // Same client-name enrichment as the actionable queue (F9, 2026-05-03
  // live audit). Without this, paused-onboarding rows show Organization =
  // `--` for every row that lacks an upstream `organizationName`.
  // Deeler-tag filter removed 2026-05-04 — see actionable-queue note above.
  const items = await _enrichOnboardingClientNames(mapped);

  return { items, total: items.length };
}

// ── Offboarding / Terminations (Admin API) ──────────────────────────────────

// Type+status matrix the team operates on (Pilar/Raquel spec, 2026-04-30,
// reconciled against upstream reality 2026-05-01):
//   Termination          → AWAITING_TRIAGE, PROCESSING
//   Resignation (Client) → AWAITING_TRIAGE, PROCESSING
//   Resignation (Employee) → AWAITING_TRIAGE, PROCESSING
//
// 2026-05-01 reality check: the spec mentioned a third actionable bucket
// `AWAITING_HRX_ACTION` for resignations, but the upstream admin API
// has no such status. The test-filter probe (since removed) enumerated
// every candidate status against `terminations_v3`:
//   • COMPLETED        → 62,012 rows (closed)
//   • AWAITING_REFUND  →  6,637 rows (post-actionable: deposit refund
//                                    and offboarding-payment phases)
//   • PROCESSING       →  1,728 rows  ← upstream-actionable
//   • AWAITING_TRIAGE  →    911 rows  ← upstream-actionable
//   • CANCELLED        →      0 rows
//   • AWAITING_HRX_ACTION → HTTP 400 from upstream (unknown value)
//   • AWAITING_PTO     → HTTP 400 as filter, but ~25 records exist with
//                        this status (visible in unfiltered scans). The
//                        upstream Joi validator is asymmetric here: it
//                        won't accept the value as a filter input but
//                        records carry it as a state value. AWAITING_PTO
//                        is a date-gated wait (employee consuming accrued
//                        PTO before final exit); HRX has no action there
//                        and there's no UI bucket for it — same shape as
//                        AWAITING_REFUND, treated as post-actionable.
//   • + 23 other guesses, all rejected by upstream Joi validator
// The 4 accepted statuses + 25 AWAITING_PTO ≈ 71,313 baseline, so the
// matrix is exhaustive: AWAITING_HRX_ACTION is dead, AWAITING_PTO is
// post-actionable, and only AWAITING_TRIAGE + PROCESSING are actionable.
//
// 2026-05-01 fix: server-side filtering via `status[]=X&status[]=Y` IS
// supported (the earlier "Joi rejects status[]" comment turned out to
// be wrong — an unrelated misconfig made it look like a validator
// rejection). Sending the two actionable values directly cuts the
// upstream haystack from 71,313 records → 2,639 records, and — more
// importantly — closes a correctness gap. The pre-filter scan sorted
// createdAt DESC and stopped after the empty-page slack expired, which
// left older PROCESSING records past the horizon unseen. Live audit
// 2026-05-01 captured upstream PROCESSING=1,728 vs scan-seen=1,336 —
// ~392 actionable records were being silently dropped from the queue
// every cycle. With the server filter, every page returned is in the
// actionable set, so we walk the full ~53 pages with no early-stop
// risk and pick all of them up. Scan time drops from ~17 minutes →
// ~50 seconds; the 200-empty-page slack (designed for the unfiltered
// scan's long tail) is no longer needed.
//
// The Termination/Resignation matrix below is functionally redundant
// now that AWAITING_HRX_ACTION is gone — Termination and Resignation
// share the same two actionable statuses — but it stays as
// documentation of intent in case Deel ever introduces a real per-type
// status divergence (e.g. an `AWAITING_HRX_ACTION` that actually exists).
const OFFBOARDING_ACTIONABLE_STATUSES = [
  'AWAITING_TRIAGE',
  'PROCESSING',
];
const OFFBOARDING_TERMINATION_STATUSES = new Set([
  'AWAITING_TRIAGE',
  'PROCESSING',
]);
const OFFBOARDING_RESIGNATION_STATUSES = new Set([
  'AWAITING_TRIAGE',
  'PROCESSING',
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
// request. With the server-side `status[]=` filter applied the haystack
// shrinks to ~2,640 records (~53 pages at limit=50), so this cap is
// pure paranoia: if upstream ever returns more, we don't want to walk
// forever. Pre-filter this was a real concern (~514 pages of mostly
// closed records); post-filter it's safety net only.
const OFFBOARDING_MAX_PAGES = 1000;

// Empty-page early-stop threshold. Pre-filter we walked through long
// stretches of closed records (COMPLETED dominates the unfiltered tail)
// and needed 200 empty pages of slack to be confident we were past the
// actionable horizon. With the server-side filter, every page returned
// is *already* actionable, so an empty page is much rarer and far more
// meaningful — 20 in a row reliably signals "we've drained the queue".
// Tightening this from 200 → 20 saves ~5 minutes of wall time on a
// cold scan when the upstream filter does its job.
const OFFBOARDING_EMPTY_PAGE_STOP = 20;

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
 *   1. Run one cursor stream PER actionable status (TRIAGE, PROCESSING)
 *      in parallel via Promise.all. Each stream pins the filter on the
 *      initial request (?status[]=X&sortBy=createdAt&sort=DESC) and
 *      walks its own cursor. The upstream cursor inherits the filter
 *      from the initial request — same convention sortBy uses.
 *   2. Apply the flow-step matrix client-side per page (excluded steps
 *      like AwaitingDepositConfirmation are filtered locally; upstream
 *      doesn't expose a flow-step filter param). Track raw status
 *      counts as we go so the route handler can surface them to the UI.
 *   3. Empty-page early-stop is per-stream and defensive only: with
 *      the server filter, every page in a stream is already in the
 *      actionable status, so empty pages mean "matrix dropped all
 *      records on this page" (excluded flow steps clustered late in
 *      the lifecycle). 20 in a row reliably signals "drained".
 *   4. Merge the streams; dedupe by id (defensive — the two statuses
 *      are disjoint sets upstream).
 *
 * Wall time is now max(stream durations) instead of their sum, since
 * the streams overlap. PROCESSING is the larger set (~1,728 records,
 * ~35 pages) so it dominates: total scan ≈ 35 × ~1.5s/page ≈ 52s.
 *
 * The previous strategy (single createdAt DESC stream + 200-page
 * empty-stop, no server filter) had a correctness bug: ~400 older
 * PROCESSING records past the horizon were silently dropped every
 * cycle. The server-side per-status filter walks the full actionable
 * set in ~52s instead of ~17 minutes for a partial set.
 *
 * Per-type rules applied via isOffboardingActionable:
 *   Termination          → status in (AWAITING_TRIAGE, PROCESSING)
 *   Resignation (any)    → status in (AWAITING_TRIAGE, PROCESSING)
 *   Plus: isDuplicate=false AND no excluded flow step.
 *
 * Returns: { items, statusCounts } so the route can include the
 * upstream breakdown alongside the filtered list. statusCounts is the
 * raw distribution across every record we scanned, useful for the
 * panel header ("X actionable of Y total open: A triage / B processing").
 */
export async function listOffboardingCases() {
  const statusCounts = {};                  // raw upstream distribution (merged across streams)
  const seen = new Set();
  const kept = [];
  let serverTotal = null;
  let totalScanned = 0;
  let totalPages = 0;
  let mode = 'admin-scan';
  const startedAt = Date.now();

  function recordStatus(t) {
    const s = (t?.status || '').toUpperCase() || '_UNKNOWN';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  // Walk one cursor stream filtered to a single status. Each call is
  // self-contained (its own page/cursor/empty-run state) so multiple can
  // run in parallel via Promise.all without stepping on each other.
  // Returns { kept, scanned, pages, statusTotal } — the caller merges.
  async function scanOneStatus(status) {
    const local = { kept: [], scanned: 0, pages: 0, statusTotal: null };
    const initialQs = `limit=50&sortBy=createdAt&sort=DESC&status%5B%5D=${status}`;
    let cursor = null;
    let page = 0;
    let emptyRun = 0;
    for (; page < OFFBOARDING_MAX_PAGES; page++) {
      const qs = cursor ? `cursor=${encodeURIComponent(cursor)}` : initialQs;
      const res = await deelFetch(`/admin/eor/terminations_v3?${qs}`);
      if (local.statusTotal === null) local.statusTotal = res?.count?.total ?? null;
      let keptThisPage = 0;
      for (const t of res?.terminations || []) {
        local.scanned++;
        recordStatus(t);
        if (!isOffboardingActionable(t)) continue;
        local.kept.push(t);
        keptThisPage++;
      }
      if (keptThisPage === 0) emptyRun++; else emptyRun = 0;
      cursor = res?.cursor || null;
      if (!cursor) break;
      if (emptyRun >= OFFBOARDING_EMPTY_PAGE_STOP) {
        console.log(`[offboarding] early-stop on status=${status}: ${OFFBOARDING_EMPTY_PAGE_STOP} empty pages in a row at page ${page + 1}`);
        break;
      }
    }
    local.pages = page + 1;
    if (page >= OFFBOARDING_MAX_PAGES) {
      console.warn(`[offboarding] hit OFFBOARDING_MAX_PAGES on status=${status} — may be missing records`);
    }
    return local;
  }

  if (!DEEL_ADMIN_TOKEN) {
    // No admin JWT: the REST v2 token can't paginate /admin/* endpoints.
    // Fall back to a single default page (still filtered) and apply matrix.
    mode = 'rest-v2-fallback';
    const initialQs = 'limit=50&sortBy=createdAt&sort=DESC'
      + OFFBOARDING_ACTIONABLE_STATUSES.map(s => `&status%5B%5D=${s}`).join('');
    const res = await deelFetch(`/admin/eor/terminations_v3?${initialQs}`);
    serverTotal = res?.count?.total ?? null;
    for (const t of res?.terminations || []) {
      totalScanned++;
      recordStatus(t);
      if (seen.has(t.id)) continue;
      if (!isOffboardingActionable(t)) continue;
      seen.add(t.id);
      kept.push(t);
    }
    console.log(`[offboarding] mode=${mode}, scanned ${totalScanned}, kept ${kept.length} (server total=${serverTotal}, statuses=${JSON.stringify(statusCounts)})`);
  } else {
    // Admin JWT present: run one cursor stream per actionable status in
    // parallel, then merge + dedupe by id. Since the two statuses are
    // disjoint sets upstream, dedup is defensive only — but cheap.
    // Wall time becomes max(stream_durations) instead of their sum,
    // cutting a ~80s scan to roughly the longer stream's duration
    // (~52s for the PROCESSING set on the live cohort, 2026-05-01).
    //
    // Per-promise catch: `Promise.all` rejects fast and silently drops
    // ANY further rejections that resolve later. During a Deel 500-storm
    // both streams fail almost simultaneously — the second rejection
    // would otherwise leak past the outer try/catch as a process-level
    // `unhandledRejection` (logged 7× on 2026-05-11 in the live audit).
    // Wrapping each stream in its own `.catch` confines failures to
    // their own slot and lets the merger decide whether partial results
    // are usable. If every stream fails we throw so the route handler's
    // stale-cache fallback still fires (the original "all-fail" behaviour
    // is preserved — only the unhandled-rejection noise is removed).
    const failureFlags = new Array(OFFBOARDING_ACTIONABLE_STATUSES.length).fill(null);
    const results = await Promise.all(
      OFFBOARDING_ACTIONABLE_STATUSES.map((s, idx) => scanOneStatus(s).catch(err => {
        failureFlags[idx] = err;
        console.warn(`[offboarding] status=${s} stream failed:`, err?.message || err);
        return null;
      })),
    );
    const failureCount = failureFlags.filter(Boolean).length;
    if (failureCount === OFFBOARDING_ACTIONABLE_STATUSES.length) {
      // Every stream failed — surface the first error so the caller can
      // fall back to stale cache. Without this we'd return zero rows
      // silently and the FE would think the queue is empty.
      throw failureFlags.find(Boolean);
    }
    let serverTotalSum = 0;
    let everSawTotal = false;
    for (const r of results) {
      if (!r) continue; // failed stream — already logged, skip
      totalScanned += r.scanned;
      totalPages += r.pages;
      if (Number.isFinite(r.statusTotal)) {
        serverTotalSum += r.statusTotal;
        everSawTotal = true;
      }
      for (const t of r.kept) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        kept.push(t);
      }
    }
    // serverTotal here is the sum of upstream count.total per actionable
    // status — the "actionable upstream" count, not the global 71k+ total
    // (which was meaningless once we filter). Surface it so the panel
    // header can read "kept N of Y upstream-actionable".
    serverTotal = everSawTotal ? serverTotalSum : null;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[offboarding] mode=${mode}, parallel-by-status streams=${results.length}, totalPages=${totalPages}, totalScanned=${totalScanned}, kept=${kept.length}, elapsed=${elapsed}s (upstream-actionable total=${serverTotal}, statuses=${JSON.stringify(statusCounts)})`);
  }
  // Backwards-compat shims — the caller reads `pages` and `scanned`
  // off the result. Map the merged totals so both shapes work.
  const page = Math.max(0, totalPages - 1);
  const scanned = totalScanned;

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

  // Deeler-tag filter removed 2026-05-04 — see actionable-onboarding note.
  const items = mapped;

  // Return both the actionable items AND the raw upstream status
  // distribution so the route handler can surface "of N total open in
  // the upstream queue, M are actionable" to the panel header.
  return { items, statusCounts, serverTotal, scanned, pages: page + 1 };
}

// `listAmendments` (/rest/v2/contracts/amendments) and `listInvoices`
// (/rest/v2/invoices) were dead code as of 2026-05-13 — no caller anywhere
// in src/ or app/. Removed alongside the REST-v2 deprecation pass.

// ── Incentive Plans (Admin API) ─────────────────────────────────────────────
// /admin/eor-experience/incentive-plans — pending IP preparation feed.
// List endpoint payload is sparse (id, createdAt, employeeLegalName,
// startDate, isWhiteLabeled). To fill the Country / Organization columns
// the FE Queue needs, we fan out per-row to the detail endpoint
// /admin/eor-experience/incentive-plans/{id} which carries `country`,
// `eorContractId`, and an organization reference. Detail responses are
// cached aggressively (1h) since the IP id never changes shape.
//
// Same SLA semantics as redlines per the 2026-05-01 spec — 5 biz-days
// active from createdAt, 48h biz from pausedAt when paused. Country is
// load-bearing for the country-OR-assignee scope (incentive plans have
// no upstream assignee), so a row missing country is invisible to non-
// admin users; the enrichment best-effort fills it.

const INCENTIVE_PLAN_PAGE_SIZE = 50;
const INCENTIVE_PLAN_MAX_PAGES = 40;

async function fetchIncentivePlanPage(status, cursor) {
  const qs = new URLSearchParams();
  qs.set('status', status);
  if (cursor) {
    // The admin API's cursor token already carries the filter+sort state —
    // sending limit/status alongside an existing cursor returns 400 (same
    // pattern as terminations_v3).
    qs.set('cursor', cursor);
  } else {
    qs.set('limit', String(INCENTIVE_PLAN_PAGE_SIZE));
  }
  const res = await deelFetch(`/admin/eor-experience/incentive-plans?${qs.toString()}`);
  return { items: res?.data || [], cursor: res?.cursor || null };
}

async function fetchAllIncentivePlansForStatus(status) {
  const all = [];
  let cursor = null;
  for (let page = 0; page < INCENTIVE_PLAN_MAX_PAGES; page++) {
    const res = await fetchIncentivePlanPage(status, cursor);
    all.push(...res.items);
    cursor = res.cursor;
    if (!cursor || res.items.length === 0) break;
  }
  return all;
}

// Per-row detail enrichment — list endpoint doesn't carry country/org.
// Fetches /admin/eor-experience/incentive-plans/{id} and mines:
//   - country / countryCode (from the upstream record or its eorContract)
//   - eorContractId (so we can chain into /admin/api/contract/{oid}
//     for the org name)
//   - status (in case the upstream surfaces a paused/triaged sub-status)
const INCENTIVE_PLAN_DETAIL_CACHE = new Map();
const INCENTIVE_PLAN_DETAIL_TTL_MS = 60 * 60 * 1000;
const INCENTIVE_PLAN_DETAIL_CONCURRENCY = 5;

async function fetchIncentivePlanDetail(planId) {
  if (!planId) return null;
  const key = String(planId);
  const hit = INCENTIVE_PLAN_DETAIL_CACHE.get(key);
  if (hit && Date.now() - hit.ts < INCENTIVE_PLAN_DETAIL_TTL_MS) return hit.detail;
  try {
    const r = await deelFetch(`/admin/eor-experience/incentive-plans/${encodeURIComponent(key)}`);
    // Field paths broadened 2026-05-01 — Mohamed reported every IP row in
    // prod showed "--" for Country and Organization. The admin API surfaces
    // these under non-uniform keys depending on the IP type (whitelabel vs
    // direct, contract-bound vs template). Mirror offboarding's pattern of
    // reading `employmentCountry` + `organizationName` first, then fall
    // back to the older nested paths so any payload variant resolves.
    const detail = {
      country:        r?.country
                   || r?.countryCode
                   || r?.employmentCountry
                   || r?.eorContract?.country
                   || r?.eorContract?.countryCode
                   || r?.eorContract?.employmentCountry
                   || r?.contract?.country
                   || r?.contract?.countryCode
                   || r?.employee?.country
                   || '',
      eorContractId:  r?.eorContractId
                   || r?.contractId
                   || r?.contractOid
                   || r?.eorContract?.id
                   || r?.eorContract?.oid
                   || r?.contract?.id
                   || r?.contract?.oid
                   || '',
      orgName:        r?.eorContract?.organization?.name
                   || r?.organization?.name
                   || r?.organizationName
                   || r?.eorContract?.team?.organization?.name
                   || r?.team?.organization?.name
                   || r?.contract?.organization?.name
                   || '',
      status:         r?.status || '',
      pausedAt:       r?.pausedAt || null,
      isPaused:       r?.isPaused === true,
    };
    INCENTIVE_PLAN_DETAIL_CACHE.set(key, { detail, ts: Date.now() });
    return detail;
  } catch (e) {
    return hit?.detail || null;
  }
}

async function resolveIncentivePlanDetails(planIds) {
  const unique = [...new Set(planIds.filter(Boolean).map(String))];
  const resolved = new Map();
  for (let i = 0; i < unique.length; i += INCENTIVE_PLAN_DETAIL_CONCURRENCY) {
    const batch = unique.slice(i, i + INCENTIVE_PLAN_DETAIL_CONCURRENCY);
    const results = await Promise.all(batch.map(fetchIncentivePlanDetail));
    batch.forEach((id, idx) => { if (results[idx]) resolved.set(id, results[idx]); });
  }
  return resolved;
}

/**
 * Fetches incentive-plan rows for one or more upstream statuses.
 * Default = ['PENDING_IP_PREPARATION'] (the only actionable bucket today).
 * Returns rows with the list-endpoint fields PLUS the detail-enriched
 * country / eorContractId / orgName when available.
 */
export async function listIncentivePlans(params = {}) {
  const statusList = Array.isArray(params.status)
    ? params.status
    : [params.status || 'PENDING_IP_PREPARATION'];

  const batches = await Promise.all(statusList.map(fetchAllIncentivePlansForStatus));

  const seen = new Set();
  const rawItems = [];
  for (let i = 0; i < batches.length; i++) {
    for (const r of batches[i]) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      rawItems.push({ __status: statusList[i], ...r });
    }
  }
  if (rawItems.length === 0) return { items: [], total: 0 };

  // Per-row detail fetch to fill country / contract / org. The first
  // refresh is the slow path (~N requests with concurrency 5); subsequent
  // refreshes hit the 1-hour cache.
  const detailMap = await resolveIncentivePlanDetails(rawItems.map(r => r.id));

  // Helper — pick the contract OID from any of the three field surfaces
  // (list item / IP detail / nested eorContract). Mirrors the 2026-05-01
  // broadening in fetchIncentivePlanDetail; offboarding's list response
  // exposes `eorContractId` inline so IP rows often do too, but the
  // previous code only looked at the detail-call's view.
  const pickOid = (r, d) => (d?.eorContractId)
    || r?.eorContractId
    || r?.contractId
    || r?.contractOid
    || r?.eorContract?.id
    || r?.eorContract?.oid
    || r?.contract?.id
    || r?.contract?.oid
    || '';

  // Use the contract OID (when present) to drop Deel-internal contracts and
  // pick up the canonical org name via /admin/api/contract/{oid}.
  const oidsForContract = [];
  for (const r of rawItems) {
    const oid = pickOid(r, detailMap.get(r.id));
    if (oid) oidsForContract.push(oid);
  }
  const contractDetails = oidsForContract.length > 0
    ? await resolveContractDetails(oidsForContract)
    : new Map();

  // Deeler-tag filter removed 2026-05-04 — see actionable-onboarding note.
  let missingCountry = 0, missingOrg = 0;
  const items = [];
  for (const r of rawItems) {
    const d = detailMap.get(r.id) || {};
    const oid = pickOid(r, d);
    const cd = oid ? contractDetails.get(String(oid)) : null;
    // Country / orgName lookup chain — same priority order as offboarding:
    // contract detail (canonical) → IP detail → list item. List-item
    // fallbacks were absent before today, which is why every row showed
    // "--" when Deel started returning country/org only on the list payload.
    const country = cd?.country
                 || d.country
                 || r?.country
                 || r?.countryCode
                 || r?.employmentCountry
                 || r?.eorContract?.country
                 || r?.eorContract?.countryCode
                 || r?.eorContract?.employmentCountry
                 || '';
    const orgName = cd?.orgName
                 || d.orgName
                 || r?.organizationName
                 || r?.organization?.name
                 || r?.eorContract?.organization?.name
                 || r?.eorContract?.team?.organization?.name
                 || '';
    if (!country) missingCountry++;
    if (!orgName) missingOrg++;
    items.push({
      id:                r.id || '',
      __status:          r.__status,
      status:            d.status || r.__status || 'PENDING_IP_PREPARATION',
      employeeName:      r.employeeLegalName || cd?.employeeName || '',
      startDate:         r.startDate || '',
      createdAt:         r.createdAt || '',
      country,
      orgName,
      eorContractId:     d.eorContractId || oid || '',
      contractOid:       cd?.contractOid || oid || '',
      isWhiteLabeled:    !!r.isWhiteLabeled,
      // Pause hooks — most rows aren't paused, but if the detail call
      // returns one, normalizeIncentivePlans will tick the SLA from
      // pausedAt instead of createdAt.
      isPaused:          !!d.isPaused,
      pausedAt:          d.pausedAt || null,
    });
  }
  // Surface enrichment gaps so the next regression is easy to diagnose
  // without redeploying with debug logging. Both cd and d enrich asynchronously
  // — if a large fraction is missing it usually means the upstream payload
  // changed shape and a new path needs to be added above.
  if (items.length > 0 && (missingCountry > 0 || missingOrg > 0)) {
    console.warn(`[incentive-plans] enrichment gaps: ${missingCountry}/${items.length} missing country, ${missingOrg}/${items.length} missing orgName`);
  }
  return { items, total: items.length };
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
// Used by feeds that need contract.country / contract.orgName / employeeName
// (Onboarding, Paused Onboarding, Amendments, Redlines, Workbench,
// Offboarding, Incentive Plans). The Deel admin payloads don't carry these
// inline on most rows — we fetch /admin/api/contract/{oid} to read them.
// Shared across feeds so a contract referenced by both an amendment and a
// workbench task only round-trips once per hour.
// LRU-bounded contract-detail cache. The previous unbounded `Map` grew
// every time a contract was resolved (onboarding + offboarding +
// amendments + redlines + workbench + incentive plans all feed into it).
// Stale entries were never pruned — only checked at read time — so after
// a few hours of running the map could hold tens of thousands of dead
// entries. 2026-05-12 memory audit pinned this as a contributor to the
// > 3 GiB RSS spikes that triggered OOM kills.
//
// Cap: 4000 entries (covers all currently-active Deel rows with headroom).
// Eviction: O(1) LRU via insertion-ordered Map — re-set on read to move
// the entry to the tail, drop the head when over cap.
const CONTRACT_DETAIL_CACHE_MAX = 4000;
const CONTRACT_DETAIL_CACHE = new Map();
const CONTRACT_DETAIL_TTL_MS = 60 * 60 * 1000;
const CONTRACT_DETAIL_CONCURRENCY = 5;

function _contractCacheTouch(key, entry) {
  // Re-insert moves the entry to the tail in a v8-spec Map's iteration
  // order, making the head the least-recently-touched key. Safe to call
  // during reads — the entry object reference is preserved.
  CONTRACT_DETAIL_CACHE.delete(key);
  CONTRACT_DETAIL_CACHE.set(key, entry);
}

function _contractCacheEvict() {
  while (CONTRACT_DETAIL_CACHE.size > CONTRACT_DETAIL_CACHE_MAX) {
    const oldestKey = CONTRACT_DETAIL_CACHE.keys().next().value;
    if (oldestKey === undefined) break;
    CONTRACT_DETAIL_CACHE.delete(oldestKey);
  }
}

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
  if (hit && Date.now() - hit.ts < CONTRACT_DETAIL_TTL_MS) {
    _contractCacheTouch(key, hit);
    return hit.detail;
  }
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
    _contractCacheEvict();
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

async function enrichRedlines(items) {
  // Fetch contract detail for every contract redline (contractOid present)
  // to fill in employeeName / country / orgName when the upstream payload
  // is missing them. Template redlines (no contractOid) skip the fetch.
  // Deeler-tag filter removed 2026-05-04 — see actionable-onboarding note.
  const oids = items.filter(i => i.contractOid).map(i => i.contractOid);
  if (oids.length === 0) return items;
  const resolved = await resolveContractDetails(oids);

  return items.map(item => {
    if (!item.contractOid) return item;
    const detail = resolved.get(String(item.contractOid));
    if (!detail) return item;
    return {
      ...item,
      employeeName: item.employeeName || detail.employeeName || '',
      countryCode:  item.countryCode  || detail.country      || '',
      orgName:      item.orgName      || detail.orgName      || '',
    };
  });
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
// Concurrency cap on the per-contract enrichment fan-out. Was 5, dropped
// to 3 after 2026-05-08 logs showed `/rest/v2/contracts/<id>` accounted
// for 80 of 99 Deel API 429s in a single capture window — far and away
// the dominant rate-limit offender even after PR #500 paced the
// onboarding fan-outs. Same pattern, different route. The Retry-After-
// aware retry from PR #497 catches the survivors transparently. 100 ms
// inter-batch sleep spreads the burst so concurrent agents on the
// amendments view don't all hit the limit window at once.
const AMEND_CLIENT_CONCURRENCY = 3;
// Bumped 100 → 250 ms on 2026-05-11. The fresh-pod boot log captured
// dozens of `/rest/v2/contracts/<id>` 429s overlapping with the
// onboarding fan-out's burst. Wider inter-batch spacing spreads the
// enricher's load over a fuller second so it doesn't pile onto the same
// Deel rate-limit window. Wall time delta is ~2.4× for the enricher
// alone, but contract-name resolution isn't on the interactive critical
// path (it backfills the amendments view as data arrives).
const AMEND_CLIENT_INTER_BATCH_DELAY_MS = 250;

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
    if (i + AMEND_CLIENT_CONCURRENCY < unique.length) {
      await new Promise(r => setTimeout(r, AMEND_CLIENT_INTER_BATCH_DELAY_MS));
    }
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
 * Earliest timestamp at which the amendment entered an HRX-actionable status
 * (AmendmentRequested / WaitingHrxAction). This is the right SLA anchor —
 * Deel's `createdAt` is the moment the amendment record was first persisted
 * upstream (often weeks or months before the client confirms and the row
 * lands in HRX's queue), so SLA computed from `createdAt` paints
 * just-arrived rows as "181 days breached". Earliest of the two
 * actionable statuses keeps the clock honest across re-entry loops
 * (Paused → Unpaused returns to AmendmentRequested but the original
 * actionable timestamp is still the SLA start).
 */
function resolveActionableSince(amendmentStatuses = []) {
  const entries = amendmentStatuses
    .filter(s => /\.(AmendmentRequested|WaitingHrxAction)$/.test(s.name || ''))
    .map(s => s.AmendmentFlowStatus?.createdAt || s.updatedAt || '')
    .filter(Boolean);
  if (entries.length === 0) return '';
  return entries.sort()[0];
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
    const actionableSince = resolveActionableSince(a.amendmentStatuses);
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
      // Earliest moment HRX became responsible — used as the SLA anchor in
      // normalizeAmendments. Distinct from `createdAt` (record creation
      // upstream) which can predate HRX involvement by months.
      actionableSince,
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
  // Deeler-tag filter removed 2026-05-04 — see actionable-onboarding note.
  return { items: enriched, total: enriched.length, cursor: null };
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
  // default) so the upstream call stays cheap. Fetch BOTH terminal
  // states (COMPLETED + CLOSED) so the home/briefing "Resolved past
  // 24h" count includes everything an agent finished, not just the
  // subset that got marked COMPLETED specifically. CLOSED tasks may
  // not carry `completedAt` (workflow archives can stamp closedAt
  // instead), so the post-filter falls back to updatedAt.
  //
  // Paginated. The 2026-05-11 production log audit caught a silent
  // truncation here: the previous code was a single non-paginated
  // fetch using `params.limit` (50 by default from the route handler),
  // so anything past the first 50 finished rows in the last 24h was
  // dropped. With ~50-100 tasks/day completed on a busy team, that
  // meant the "Resolved Today" tally on AgentHome + BriefingView was
  // capped at 50. Now we paginate up to FINISHED_MAX_PAGES of
  // FINISHED_PAGE_SIZE rows. Worst case: 1000 rows / 24h, which still
  // fits comfortably below the WORKBENCH_MAX_PAGES * WORKBENCH_PAGE_SIZE
  // active-branch ceiling.
  //
  // No "early-stop on first all-out-of-window page" optimisation: the
  // upstream's row ordering on a multi-status filter
  // (COMPLETED + CLOSED) isn't documented as DESC-by-recency. If a
  // future version of the upstream interleaves rows, an early-stop
  // would silently drop in-window rows mid-walk. The post-filter on
  // `cutoff` is what enforces the lookback window per row; we just
  // walk every page the cursor surfaces and trust the filter to
  // discard old rows. Stop conditions are: empty page, no cursor,
  // safety cap.
  if (includeCompleted) {
    try {
      // Deel admin API caps `limit` at 100 — passing 200 returns
      // HTTP 400 ("limit must be less than or equal to 100") and the
      // catch below swallows it, silently producing ZERO recently-
      // finished merges (worse than the original 50-cap this branch
      // was meant to fix). 2026-05-11 prod logs caught it firing on
      // every sync cycle.
      //
      // 2026-05-12 memory audit (pod RSS spiked > 3 GiB): the
      // ~1000-row ceiling was way more than the home "Resolved Today"
      // KPI ever needs — even a busy team finishes ~50–100 tasks per
      // day. Dropping the cap to 200 (2 × 100-page batches) keeps the
      // KPI accurate AND removes a 800-row tail from the workbench
      // cache. Combined with the projection slim above, this cuts
      // worst-case workbench-cache memory roughly in half.
      //
      // 2026-05-13: bumped 2 → 5 pages (200 → 500 row ceiling) after
      // a 3-hour prod log audit showed EVERY workbench sync emitting
      // the truncation flag with `kept 185` — the upstream cursor was
      // still pointing forward past the 200-row cap, so we were
      // silently dropping a tail of recently-finished tasks each
      // cycle. That made the home "Resolved Today" KPI under-report
      // by an unknown amount on busy days. Extra memory cost: ~60 KB
      // at the worst case (500 rows × ~120 bytes per row after the
      // slim projection) — negligible vs the 1733 MiB heap we were
      // already tolerating during peak builds.
      const FINISHED_PAGE_SIZE = 100;
      const FINISHED_MAX_PAGES = 5;
      const cutoff = Date.now() - completedLookbackMs;
      const seen = new Set(allItems.map(t => t.id));
      let kept = 0;
      let truncated = false;
      let cursor = null;
      for (let page = 0; page < FINISHED_MAX_PAGES; page++) {
        const qs = new URLSearchParams();
        qs.append('status[]', 'COMPLETED');
        qs.append('status[]', 'CLOSED');
        for (const id of teamIds) qs.append('teamIds[]', id);
        qs.set('limit', String(FINISHED_PAGE_SIZE));
        if (cursor) qs.set('cursor', cursor);
        const res = await deelFetch(`/admin/ops_workbench/tasks?${qs.toString()}`);
        const pageItems = res?.result || [];
        if (pageItems.length === 0) break;
        for (const t of pageItems) {
          if (seen.has(t.id)) continue;
          const ms = (() => {
            const c = t.completedAt ? Date.parse(t.completedAt) : NaN;
            if (Number.isFinite(c) && c > 0) return c;
            const u = t.updatedAt ? Date.parse(t.updatedAt) : NaN;
            return Number.isFinite(u) && u > 0 ? u : 0;
          })();
          if (!ms || ms < cutoff) continue;
          allItems.push(t);
          seen.add(t.id);
          kept++;
        }
        cursor = res?.cursor || null;
        if (!cursor) break;
        if (page === FINISHED_MAX_PAGES - 1) truncated = true;
      }
      if (kept > 0) {
        const suffix = truncated
          ? ' (truncated at safety cap — bump FINISHED_MAX_PAGES if this fires regularly)'
          : '';
        console.info(`[workbench] kept ${kept} recently-finished task(s) — COMPLETED+CLOSED, last ${completedLookbackMs / 3600000}h${suffix}`);
      }
    } catch (err) {
      console.warn('[workbench] recently-finished fetch failed (non-fatal):', err.message);
    }
  }

  // Slim projection — only fields consumed downstream by the queue route,
  // normalizeWorkbench, and queue-scoping. Per the 2026-05-12 memory audit
  // (pod RSS spiked > 3 GiB triggering OOM kills), dropping unused fields
  // (description, statusCategory, creator, dueAt, slaTime, slaRemaining,
  // slaState, teamName/teamId, highPriority, organizationId, origin,
  // reasonForEscalation, jiraIssues, zendeskTickets, escalations) cuts
  // per-row cache footprint by ~60-70%. With ~5000 active + 200 finished
  // rows in the workbench cache, that's tens of MiB freed per refresh
  // cycle — across every Deel cache the savings multiply.
  const items = allItems.map(t => ({
    id:               t.id || '',
    name:             t.name || '',
    status:           t.status || '',                              // TO_DO, IN_PROGRESS, etc.
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
    createdAt:        t.createdAt || '',
    updatedAt:        t.updatedAt || '',
    completedAt:      t.completedAt || null,
    // SLA — only `slaBreachStatus` is read downstream (by
    // `deriveWorkbenchStatus` in the workbench route handler). The other
    // SLA fields are recomputed in `normalizeSourceRows.computeSlaWindow`
    // from `createdAt`/`pausedAt`, so caching the upstream values just
    // adds bytes.
    slaBreachStatus:  t.slaBreachStatus || '',
    // Task type — drives the "Type" column and the workbench scope.
    taskType:         t.taskConfiguration?.name || '',
    sourceType:       t.taskConfiguration?.sourceType || '',
    // Refs — contractOid powers the contract deep-link.
    contractOid:      t.contractOid || '',
  }));

  // Deeler-tag filter removed 2026-05-04 — see actionable-onboarding note.
  return { items, total: items.length, cursor: null };
}

// `getPayslips` (/rest/v2/contracts/<id>/payslips) was dead code as of
// 2026-05-13 — no caller anywhere in src/ or app/. Removed alongside the
// REST-v2 deprecation pass.

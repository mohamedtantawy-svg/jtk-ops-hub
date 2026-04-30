// ── GET /api/v1/integrations/deel/offboarding ───────────────────────────────
// Returns active EOR termination cases from the Deel Admin API.
// Uses /admin/eor/terminations_v3 — the same endpoint as admin.deel.network.
// Uses persistent file cache (survives restarts) + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listOffboardingCases, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { getIssueDescriptionsByKeys, isJiraConfigured } from '../../../../../../src/lib/jira-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';
import { scopeOffboardingCases } from '../../../../../../src/lib/queue-scoping';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';

const CACHE_KEY = 'deel_offboarding';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 60 * 60 * 1000;   // serve stale up to 60 minutes

// Assignee-based scoping per the user-spec: agents see terminations assigned
// to them; TL / RM see their subtree (and country-matched unassigned cases);
// admins see everything.
function scoped(data, user) {
  if (!data?.items) return data;
  const items = scopeOffboardingCases(data.items, user);
  return { ...data, items, total: items.length };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  await ensureRosterHydrated();

  try {
    const { searchParams } = new URL(req.url);
    const bustCache = searchParams.get('bust') === '1';

    if (!bustCache) {
      const fresh = cacheGet(CACHE_KEY, CACHE_TTL);
      if (fresh) return NextResponse.json(scoped(fresh, user));
    }

    let result;
    try {
      result = await buildOffboardingResult();
      cacheSet(CACHE_KEY, result);
    } catch (fetchErr) {
      const stale = cacheGet(CACHE_KEY, STALE_TTL);
      if (stale) {
        console.warn('[offboarding] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...scoped(stale, user), _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(scoped(result, user));
  } catch (err) {
    console.error('[integrations/deel/offboarding]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: err.status || 500 });
  }
}

async function buildOffboardingResult() {
  const raw = await listOffboardingCases();
  const now = new Date();

  // Dedupe defensively by id (listOffboardingCases already dedupes, but be safe)
  const seen = new Set();
  const deduped = [];
  for (const c of raw) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      deduped.push(c);
    }
  }

  // Enrich every record with a Zendesk URL pulled from its linked Jira
  // ticket's description (ops convention: every termination Jira ticket
  // has a Zendesk link pasted into the description body).
  const zendeskByTerminationId = await enrichZendeskUrls(deduped);

  const items = deduped.map(c => {
    // Priority: confirmed endDate → desired → original (from requestData) → earliest.
    // Empty string when nothing is set — UI renders "ASAP" in that case.
    const endDateStr = c.endDate || c.desiredEndDate || c.originalEndDate || c.earliestEndDate || '';
    const endDate = endDateStr ? new Date(endDateStr) : null;
    const daysUntilEnd = endDate ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)) : null;
    const endDateIsConfirmed = !!c.endDate;

    const { label: primaryBucket, severity, color } = derivePrimaryBucket(c);
    const typeLabel = deriveTypeLabel(c);

    return {
      id: c.id,
      contractId: c.contractId,
      contractOid: c.contractOid || '',
      name: c.name || '',
      email: c.email || '',
      country: c.country || '',
      jobTitle: c.jobTitle || '',
      team: c.team || '',
      hiringType: c.hiringType || 'eor',
      endDate: endDateStr,
      endDateIsConfirmed,                                 // false → UI shows "ASAP"-style label
      isUrgentEndDate: c.isUrgentEndDate === true,
      desiredEndDate: c.desiredEndDate || '',
      startDate: c.startDate || '',
      requestedDate: c.createdAt || '',
      updatedAt: c.updatedAt || '',                       // already falls back in listOffboardingCases
      daysUntilEnd,
      noticePeriod: c.noticePeriod || 0,
      organizationName: c.organizationName || '',
      exAssignee: c.exAssignee || '',
      exAssigneeEmail: c.exAssigneeEmail || '',
      reason: c.reason || '',
      isResignation: c.isResignation || false,
      jiraUrl: c.jiraUrl || '',
      zendeskUrl: zendeskByTerminationId.get(c.id) || '',
      adminStatus: c.status || '',
      clientSignOffStatus: c.clientSignOffStatus || '',
      employeeSignOffStatus: c.employeeSignOffStatus || '',
      terminationFlowStatuses: c.terminationFlowStatuses || [],
      typeLabel,                                          // "Termination" | "Resignation (Employee)" | "Resignation (Client)"
      primaryBucket,                                      // most-actionable bucket label
      status: { label: primaryBucket, severity, color },  // for UI status pill
      contractUrl: c.contractOid ? `https://app.deel.com/contracts/${c.contractOid}` : '',
    };
  });

  // Sort by priority (most actionable first), then end date ascending.
  items.sort((a, b) => {
    const ap = BUCKET_PRIORITY[a.primaryBucket] ?? 999;
    const bp = BUCKET_PRIORITY[b.primaryBucket] ?? 999;
    if (ap !== bp) return ap - bp;
    return (a.daysUntilEnd ?? 9999) - (b.daysUntilEnd ?? 9999);
  });

  // Breakdown by primary status bucket — log + return so we can see the
  // distribution without scraping the full item list.
  const byBucket = {};
  const byType = { Termination: 0, 'Resignation (Client)': 0, 'Resignation (Employee)': 0 };
  for (const item of items) {
    byBucket[item.primaryBucket] = (byBucket[item.primaryBucket] || 0) + 1;
    if (byType[item.typeLabel] !== undefined) byType[item.typeLabel]++;
  }
  const bucketSummary = Object.entries(byBucket)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  console.log(`[offboarding] breakdown: total=${items.length} | by type: ${JSON.stringify(byType)} | by bucket: ${bucketSummary}`);

  // If records are landing in Unknown, log one representative so we can see
  // what flow-status / sign-off / admin-status combo we need to classify next.
  const unknownSample = items.find(it => it.primaryBucket === 'Unknown');
  if (unknownSample) {
    console.log(`[offboarding] Unknown sample id=${unknownSample.id} adminStatus=${unknownSample.adminStatus} clientSO=${unknownSample.clientSignOffStatus} employeeSO=${unknownSample.employeeSignOffStatus} flows=${JSON.stringify(unknownSample.terminationFlowStatuses).slice(0, 400)}`);
  }

  return { items, total: items.length, byBucket, byType };
}

// ── Zendesk URL enrichment ──────────────────────────────────────────────────
// Each termination record carries a jiraUrl like
//   https://deel.atlassian.net/browse/DEELR-12345
// Ops convention: the Jira ticket's description contains a Zendesk link
// pointing at the underlying service-desk ticket. We batch-fetch Jira
// descriptions in one query and regex-match the Zendesk URL out.

const JIRA_KEY_FROM_URL = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/i;
// Fallback: any PROJECT-NUMBER style token anywhere in the string.
const JIRA_KEY_ANYWHERE = /\b([A-Z][A-Z0-9_]+-\d+)\b/;
// Match any *.zendesk.com URL (e.g. letsdeel.zendesk.com, deel.zendesk.com).
// Stop at whitespace or any char that would clearly end a URL.
const ZENDESK_URL_RE = /https?:\/\/[a-z0-9.-]+\.zendesk\.com\/[^\s"')<>]+/ig;

function extractJiraKey(jiraUrl) {
  if (!jiraUrl) return '';
  // Prefer /browse/<KEY>; fall back to any KEY-123 substring so we still
  // work if Deel ever returns a different URL form (API url, raw id, etc).
  const m1 = jiraUrl.match(JIRA_KEY_FROM_URL);
  if (m1) return m1[1].toUpperCase();
  const m2 = jiraUrl.match(JIRA_KEY_ANYWHERE);
  return m2 ? m2[1].toUpperCase() : '';
}

function extractZendeskUrl(description) {
  if (!description) return '';
  const matches = description.match(ZENDESK_URL_RE);
  if (!matches || matches.length === 0) return '';
  // Prefer a canonical agent ticket URL over any /hc/ help-center link.
  const agentTicket = matches.find(u => /\/(agent\/tickets|tickets)\/\d+/i.test(u));
  return (agentTicket || matches[0]).replace(/[),.;]+$/, '');
}

async function enrichZendeskUrls(records) {
  const out = new Map();
  if (!isJiraConfigured()) return out;

  const keyToIds = new Map();
  for (const c of records) {
    const key = extractJiraKey(c.jiraUrl);
    if (!key) continue;
    const ids = keyToIds.get(key) || [];
    ids.push(c.id);
    keyToIds.set(key, ids);
  }
  if (keyToIds.size === 0) return out;

  try {
    const descriptions = await getIssueDescriptionsByKeys(Array.from(keyToIds.keys()));
    let matched = 0;
    let sampleKey = '';
    let sampleZd = '';
    for (const [key, ids] of keyToIds) {
      const zd = extractZendeskUrl(descriptions.get(key));
      if (!zd) continue;
      if (!sampleKey) { sampleKey = key; sampleZd = zd; }
      matched++;
      for (const id of ids) out.set(id, zd);
    }
    console.log(`[offboarding] zendesk enrichment: ${matched}/${keyToIds.size} jira keys yielded a zendesk url${sampleKey ? ` | sample ${sampleKey} → ${sampleZd}` : ''}`);
  } catch (err) {
    console.warn('[offboarding] zendesk enrichment failed:', err.message);
  }
  return out;
}

/**
 * Derive the user-facing "Type" label from the admin record.
 *   Termination: top-level type === TERMINATION
 *   Resignation (Employee): isEmployeeResignation === true
 *   Resignation (Client): top-level type is a resignation flavor and not employee-initiated
 */
function deriveTypeLabel(c) {
  const t = (c.hiringType || '').toUpperCase();
  if (c.isResignation === true) return 'Resignation (Employee)';
  if (t.includes('RESIGNATION')) return 'Resignation (Client)';
  return 'Termination';
}

/**
 * Priority order for the primary bucket shown to ops (most actionable → least).
 * Lower number = more actionable.
 */
// Priority follows the 9-step admin workflow: earlier steps = more actionable.
// Within a step, warning sub-labels (changes requested / not responded) are
// ranked higher than the neutral in-progress variant.
const BUCKET_PRIORITY = {
  // Cross-cutting
  'Awaiting Assignee':                            1,
  // Step 1 — HRX Review (AWAITING_TRIAGE)
  'HRX Review — Awaiting Assignee':               2,
  'HRX Review — Client Review (Resignation)':     3,
  'HRX Review — Legal Input':                     4,
  'HRX Review — CSM Input':                       5,
  'HRX Review':                                   6,
  // AWAITING_HRX_ACTION — resignation-only state where HRX is the blocker
  'Awaiting HRX Action — Resignation Letter':     7,
  'Awaiting HRX Action — Legal Input':            8,
  'Awaiting HRX Action':                          9,
  // Step 2 — Client sign off
  'Client Sign Off — Changes Requested':         10,
  'Client Sign Off — Feedback Provided':         11,
  'Client Sign Off':                              12,
  // Step 3 — Employee sign off
  'Employee Sign Off — Not Responded':           20,
  'Employee Sign Off — Changes Requested':       21,
  'Employee Sign Off':                            22,
  // Step 4 — Legal input (post-triage)
  'Legal Input':                                  30,
  // Step 5 — End of contract details
  'End of Contract Details':                      40,
  // Step 6 — Offboarding payments
  'Offboarding Payments':                         50,
  // Step 7 — Unenrollment
  'Unenrollment':                                 60,
  // Fallbacks
  'Processing':                                   98,
  'Unknown':                                      99,
};

/**
 * Return true when the flow array shows that legal review has finished
 * (either completed or skipped as "not needed"). The array is a union of
 * all sub-states that have ever been active; completion markers persist.
 */
function isSubPhaseDone(flow, substring) {
  for (const f of flow) if (f.includes(substring)) return true;
  return false;
}

/**
 * Derive the primary bucket label using the admin UI's 9-step sequential
 * workflow as a mental model:
 *   1. HRX review         (top-level status AWAITING_TRIAGE)
 *   2. Client sign off    (clientSignOffStatus in progress)
 *   3. Employee sign off  (employeeSignOffStatus in progress)
 *   4. Legal input        (AwaitingLegalReview still open)
 *   5. End of contract details    (AwaitingFinalPayrollDecision)
 *   6. Offboarding payments       (OffboardingPayments)
 *   7. Unenrollment               (Unenrollment)
 *   8. Fees & Adjustments         (FeeAndAdjustments)        ← excluded upstream
 *   9. Deposit refund             (AwaitingDepositConfirmation) ← excluded
 *
 * A record's *current* step is the first one that still shows "in progress".
 * For AWAITING_TRIAGE records we sub-classify (Legal input / CSM input /
 * Client review) so the status pill reflects the real blocker.
 */
function derivePrimaryBucket(c) {
  const flow = new Set(c.terminationFlowStatuses || []);
  const status = (c.status || '').toUpperCase();
  const clientSO = (c.clientSignOffStatus || '').toUpperCase();
  const employeeSO = (c.employeeSignOffStatus || '').toUpperCase();

  // Unassigned is always the top priority — nobody is working this yet.
  if (!c.exAssigneeId && !c.exAssignee) {
    return { label: 'Awaiting Assignee', severity: 'critical', color: '#d42d35' };
  }

  // ── AWAITING_HRX_ACTION (resignation-only top-level state) ─────────────
  // When the upstream lifecycle parks a resignation in AWAITING_HRX_ACTION,
  // the queue should surface that as a clear "HRX has work to do here" pill,
  // distinct from PROCESSING (which is mid-workflow but not specifically on
  // HRX). Try to enrich with the in-flight sub-step where possible — a
  // resignation in this state is often awaiting the legal review or
  // resignation-letter signature; falling back to the generic label keeps
  // the row out of "Unknown".
  if (status === 'AWAITING_HRX_ACTION') {
    if (flow.has('AwaitingResignationLetterSignature')) {
      return { label: 'Awaiting HRX Action — Resignation Letter', severity: 'warning', color: '#ed8d00' };
    }
    if (flow.has('AwaitingLegalReview') && !isSubPhaseDone(flow, 'LegalReview.LegalReview')) {
      return { label: 'Awaiting HRX Action — Legal Input', severity: 'warning', color: '#ed8d00' };
    }
    return { label: 'Awaiting HRX Action', severity: 'warning', color: '#ed8d00' };
  }

  // ── Step 1: HRX review (top-level status AWAITING_TRIAGE) ───────────────
  // During triage, multiple sub-reviews (legal, CSM, client) run in parallel
  // and ALL must finish before the record advances to PROCESSING. Pick the
  // sub-filter that best describes the real blocker.
  if (status === 'AWAITING_TRIAGE') {
    if (flow.has('AwaitingAssignee')) {
      return { label: 'HRX Review — Awaiting Assignee', severity: 'critical', color: '#d42d35' };
    }
    if (flow.has('AwaitingClientReview')) {
      return { label: 'HRX Review — Client Review (Resignation)', severity: 'warning', color: '#ed8d00' };
    }
    if (flow.has('AwaitingLegalReview') && !isSubPhaseDone(flow, 'LegalReview.LegalReview')) {
      return { label: 'HRX Review — Legal Input', severity: 'warning', color: '#ed8d00' };
    }
    if (flow.has('AwaitingCSMReview') && !isSubPhaseDone(flow, 'CSMReview.CSMReview')) {
      return { label: 'HRX Review — CSM Input', severity: 'warning', color: '#ed8d00' };
    }
    return { label: 'HRX Review', severity: 'warning', color: '#ed8d00' };
  }

  // From here down we're dealing with status === PROCESSING (or similar).
  // Evaluate the 9-step sequence; the first "in progress" wins.

  // ── Step 2: Client sign off ─────────────────────────────────────────────
  if (clientSO === 'REQUESTED_CHANGES' || clientSO === 'CHANGES_REQUESTED_BY_EMPLOYEE') {
    return { label: 'Client Sign Off — Changes Requested', severity: 'warning', color: '#ed8d00' };
  }
  if (clientSO === 'FEEDBACK_PROVIDED') {
    return { label: 'Client Sign Off — Feedback Provided', severity: 'warning', color: '#ed8d00' };
  }
  if (clientSO === 'AWAITING_REVIEW' || clientSO === 'AWAITING_FEEDBACK') {
    return { label: 'Client Sign Off', severity: 'active', color: '#1d4ed8' };
  }

  // ── Step 3: Employee sign off ───────────────────────────────────────────
  if (employeeSO === 'NOT_RESPONDED') {
    return { label: 'Employee Sign Off — Not Responded', severity: 'warning', color: '#ed8d00' };
  }
  if (employeeSO === 'CHANGE_REQUESTED' || employeeSO === 'CHANGES_REQUESTED_BY_EMPLOYEE') {
    return { label: 'Employee Sign Off — Changes Requested', severity: 'warning', color: '#ed8d00' };
  }
  if (employeeSO === 'AWAITING_REVIEW' || employeeSO === 'AWAITING_SIGNATURE') {
    return { label: 'Employee Sign Off', severity: 'active', color: '#1d4ed8' };
  }

  // ── Step 4: Legal input ─────────────────────────────────────────────────
  if (flow.has('AwaitingLegalReview') && !isSubPhaseDone(flow, 'LegalReview.LegalReview')) {
    return { label: 'Legal Input', severity: 'active', color: '#1d4ed8' };
  }

  // ── Step 5: End of contract details ─────────────────────────────────────
  if (flow.has('AwaitingFinalPayrollDecision') || flow.has('EndDetails')) {
    return { label: 'End of Contract Details', severity: 'active', color: '#1d4ed8' };
  }

  // ── Step 6: Offboarding payments ────────────────────────────────────────
  if (flow.has('OffboardingPayments')) {
    return { label: 'Offboarding Payments', severity: 'active', color: '#1d4ed8' };
  }

  // ── Step 7: Unenrollment ────────────────────────────────────────────────
  if (flow.has('Unenrollment')) {
    return { label: 'Unenrollment', severity: 'active', color: '#1d4ed8' };
  }

  // ── Steps 8/9: excluded upstream (should not reach here) ───────────────
  // Fallbacks — top-level status when nothing specific matched
  if (status === 'PROCESSING' || status === 'IN_PROGRESS') {
    return { label: 'Processing', severity: 'active', color: '#1d4ed8' };
  }
  return { label: 'Unknown', severity: 'info', color: '#9e9e9e' };
}

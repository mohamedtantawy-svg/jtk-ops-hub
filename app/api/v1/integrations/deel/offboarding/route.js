// ── GET /api/v1/integrations/deel/offboarding ───────────────────────────────
// Returns active EOR termination cases from the Deel Admin API.
// Uses /admin/eor/terminations_v3 — the same endpoint as admin.deel.network.
// Uses persistent file cache (survives restarts) + stale-while-revalidate.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listOffboardingCases, isDeelConfigured } from '../../../../../../src/lib/deel-api';
import { cacheGet, cacheSet } from '../../../../../../src/lib/server-cache';

const CACHE_KEY = 'deel_offboarding';
const CACHE_TTL = 5 * 60 * 1000;    // fresh for 5 minutes
const STALE_TTL = 60 * 60 * 1000;   // serve stale up to 60 minutes

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isDeelConfigured()) {
    return NextResponse.json({ error: 'Deel API not configured' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const bustCache = searchParams.get('bust') === '1';

    if (!bustCache) {
      const fresh = cacheGet(CACHE_KEY, CACHE_TTL);
      if (fresh) return NextResponse.json(fresh);
    }

    let result;
    try {
      result = await buildOffboardingResult();
      cacheSet(CACHE_KEY, result);
    } catch (fetchErr) {
      const stale = cacheGet(CACHE_KEY, STALE_TTL);
      if (stale) {
        console.warn('[offboarding] Fetch failed, returning stale cache:', fetchErr.message);
        return NextResponse.json({ ...stale, _stale: true });
      }
      throw fetchErr;
    }

    return NextResponse.json(result);
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

  return { items, total: items.length, byBucket, byType };
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
const BUCKET_PRIORITY = {
  'Awaiting Assignee':                        1,
  'Awaiting Triage':                          2,
  'Awaiting Client Review':                   3,
  'Client Sign-Off: Changes Requested':       4,
  'Employee Sign-Off: Changes Requested':     5,
  'Employee Sign-Off: Not Responded':         6,
  'Awaiting Legal Review':                    7,
  'Awaiting Docs → Client':                   8,
  'Awaiting Docs → Employee':                 9,
  'Docs: Employee Notification':             10,
  'Docs: Documents Confirmation':            11,
  'Docs: Employee Signature':                12,
  'Client Sign-Off: Awaiting Client Review': 13,
  'Client Sign-Off: Awaiting Feedback':      14,
  'Client Sign-Off: Feedback Provided':      15,
  'Client Sign-Off: Approved':               16,
  'Employee Sign-Off: Signed':               17,
  'Awaiting Final Payroll Decision':         18,
  'Offboarding Payments':                    19,
  'Unenrollment':                            20,
  'Processing':                              98,
  'Unknown':                                 99,
};

/**
 * Pick the single most-actionable bucket label + severity + color for a record.
 * Evaluates (in priority order): unassigned → top-level status → sign-off sub-states
 * → flow-status array. First match wins.
 */
function derivePrimaryBucket(c) {
  const flow = new Set(c.terminationFlowStatuses || []);
  const status = (c.status || '').toUpperCase();
  const clientSO = (c.clientSignOffStatus || '').toUpperCase();
  const employeeSO = (c.employeeSignOffStatus || '').toUpperCase();

  // 1 — unassigned
  if (!c.exAssigneeId && !c.exAssignee) {
    return { label: 'Awaiting Assignee', severity: 'critical', color: '#d42d35' };
  }

  // 2 — top-level triage (not yet entered review)
  if (status === 'AWAITING_TRIAGE') {
    return { label: 'Awaiting Triage', severity: 'warning', color: '#ed8d00' };
  }

  // 3 — client is blocking us
  if (flow.has('AwaitingClientReview')) {
    return { label: 'Awaiting Client Review', severity: 'warning', color: '#ed8d00' };
  }

  // 4/5 — changes-requested loops (high touch)
  if (clientSO === 'CHANGES_REQUESTED_BY_EMPLOYEE' || clientSO === 'REQUESTED_CHANGES') {
    return { label: 'Client Sign-Off: Changes Requested', severity: 'warning', color: '#ed8d00' };
  }
  if (employeeSO === 'CHANGES_REQUESTED_BY_EMPLOYEE' || employeeSO === 'CHANGE_REQUESTED') {
    return { label: 'Employee Sign-Off: Changes Requested', severity: 'warning', color: '#ed8d00' };
  }
  if (employeeSO === 'NOT_RESPONDED') {
    return { label: 'Employee Sign-Off: Not Responded', severity: 'warning', color: '#ed8d00' };
  }

  // 7–12 — flow-status buckets (actionable ops work)
  if (flow.has('AwaitingLegalReview')) {
    return { label: 'Awaiting Legal Review', severity: 'active', color: '#1d4ed8' };
  }
  if (flow.has('AwaitingDocumentSharingForClientApproval')) {
    return { label: 'Awaiting Docs → Client', severity: 'active', color: '#1d4ed8' };
  }
  if (flow.has('AwaitingDocumentSharingForEmployeeApproval')) {
    return { label: 'Awaiting Docs → Employee', severity: 'active', color: '#1d4ed8' };
  }
  if (flow.has('Documents#EMPLOYEE_NOTIFICATION')) {
    return { label: 'Docs: Employee Notification', severity: 'active', color: '#1d4ed8' };
  }
  if (flow.has('Documents#DOCUMENTS_CONFIRMATION')) {
    return { label: 'Docs: Documents Confirmation', severity: 'active', color: '#1d4ed8' };
  }
  if (flow.has('Documents#EMPLOYEE_SIGNATURE')) {
    return { label: 'Docs: Employee Signature', severity: 'active', color: '#1d4ed8' };
  }

  // 13–16 — client sign-off positive path
  if (clientSO === 'AWAITING_REVIEW') {
    return { label: 'Client Sign-Off: Awaiting Client Review', severity: 'active', color: '#1d4ed8' };
  }
  if (clientSO === 'AWAITING_FEEDBACK') {
    return { label: 'Client Sign-Off: Awaiting Feedback', severity: 'active', color: '#1d4ed8' };
  }
  if (clientSO === 'FEEDBACK_PROVIDED') {
    return { label: 'Client Sign-Off: Feedback Provided', severity: 'active', color: '#1d4ed8' };
  }
  if (clientSO === 'APPROVED') {
    return { label: 'Client Sign-Off: Approved', severity: 'info', color: '#616161' };
  }

  // 17 — employee sign-off positive path
  if (employeeSO === 'APPROVED' || employeeSO === 'SIGNED') {
    return { label: 'Employee Sign-Off: Signed', severity: 'info', color: '#616161' };
  }

  // 18–20 — late-stage flow buckets
  if (flow.has('AwaitingFinalPayrollDecision')) {
    return { label: 'Awaiting Final Payroll Decision', severity: 'active', color: '#1d4ed8' };
  }
  if (flow.has('OffboardingPayments')) {
    return { label: 'Offboarding Payments', severity: 'active', color: '#1d4ed8' };
  }
  if (flow.has('Unenrollment')) {
    return { label: 'Unenrollment', severity: 'active', color: '#1d4ed8' };
  }

  // Fallbacks
  if (status === 'PROCESSING' || status === 'IN_PROGRESS') {
    return { label: 'Processing', severity: 'active', color: '#1d4ed8' };
  }
  return { label: 'Unknown', severity: 'info', color: '#9e9e9e' };
}

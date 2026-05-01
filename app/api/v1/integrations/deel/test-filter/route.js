// ── GET /api/v1/integrations/deel/test-filter ───────────────────────────────
// TEMPORARY — probes which filter param shapes `terminations_v3` accepts
// AND enumerates the full set of distinct status values upstream uses.
// Owner-gated so it can't leak in production traffic. Remove once we've
// landed the proper server-side filter on listOffboardingCases().
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { deelFetch } from '../../../../../../src/lib/deel-api';

const OWNER_EMAIL = 'mohamed.tantawy@deel.com';

// Every status value we've seen referenced anywhere — from our codebase,
// the Deel admin UI's bucket labels, prior log lines, and reasonable guesses.
// Each gets a one-off `?status[]=X&limit=1` call so we read its `count.total`.
// If the API rejects an unknown value with a 400, we record that too.
const CANDIDATE_STATUSES = [
  // From the audit logs we already saw:
  'AWAITING_TRIAGE',
  'AWAITING_PTO',
  'PROCESSING',
  'AWAITING_REFUND',
  'COMPLETED',
  // Mentioned in our existing actionable matrix:
  'AWAITING_HRX_ACTION',
  // Visible as buckets in the Deel admin UI:
  'AWAITING_OPS_ACTIONS',
  'AWAITING_OPS_ACTION',
  'AWAITING_CLIENT_ACTIONS',
  'AWAITING_CLIENT_ACTION',
  'CANCELLED',
  // Common termination lifecycle states worth probing:
  'DONE',
  'DELETED',
  'ARCHIVED',
  'IN_PROGRESS',
  'PENDING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'AWAITING_LEGAL_INPUT',
  'AWAITING_LEGAL',
  'LEGAL_REVIEW',
  'AWAITING_FINANCE',
  'AWAITING_PAYROLL',
  'AWAITING_PAYMENT',
  'AWAITING_DOCUMENTS',
  'AWAITING_DOCS',
  'AWAITING_SIGNATURE',
  'CLIENT_SIGN_OFF',
  'EMPLOYEE_SIGN_OFF',
  'UNENROLLMENT',
];

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.email.toLowerCase() !== OWNER_EMAIL) {
    return NextResponse.json({ error: 'Forbidden — owner-gated' }, { status: 403 });
  }

  // Step 1: baseline (no filter) → upstream's grand total
  const baseline = await safeProbe('limit=1');

  // Step 2: per-status probes (parallel, capped)
  const statusResults = await Promise.all(
    CANDIDATE_STATUSES.map(async (s) => {
      const probe = await safeProbe(`limit=1&status%5B%5D=${s}`);
      return { status: s, ...probe };
    }),
  );

  // Step 3: empirical scan — pull the first 5 pages unfiltered (250 records)
  // and report distinct status values + their counts. This catches anything
  // we forgot to include in CANDIDATE_STATUSES.
  let cursor = null;
  const empirical = {};
  for (let i = 0; i < 5; i++) {
    const qs = cursor
      ? `cursor=${encodeURIComponent(cursor)}`
      : 'limit=50&sortBy=createdAt&sort=DESC';
    const res = await deelFetch(`/admin/eor/terminations_v3?${qs}`).catch(() => null);
    if (!res) break;
    for (const t of res?.terminations || []) {
      const s = (t?.status || '_UNKNOWN').toUpperCase();
      empirical[s] = (empirical[s] || 0) + 1;
    }
    cursor = res?.cursor || null;
    if (!cursor) break;
  }

  // Sum the totals from the per-status probes that returned 200, sort
  // descending so the response is easy to read.
  const accepted = statusResults
    .filter((r) => r.ok && Number.isFinite(r.total))
    .sort((a, b) => (b.total || 0) - (a.total || 0));
  const rejected = statusResults
    .filter((r) => !r.ok)
    .map((r) => ({ status: r.status, httpStatus: r.httpStatus }));
  const acceptedSum = accepted.reduce((sum, r) => sum + (r.total || 0), 0);

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    baselineTotal: baseline.total,
    accepted,
    rejected,
    acceptedSum,
    coverageNote: baseline.total
      ? `${acceptedSum} of ${baseline.total} accounted for (${Math.round(100 * acceptedSum / baseline.total)}%)`
      : 'baseline unavailable',
    empiricalFromFirst5Pages: empirical,
  });
}

async function safeProbe(qs) {
  const startedAt = Date.now();
  try {
    const res = await deelFetch(`/admin/eor/terminations_v3?${qs}`);
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      total: res?.count?.total ?? null,
      firstStatus: res?.terminations?.[0]?.status || null,
    };
  } catch (err) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      httpStatus: err.status || null,
      message: (err.message || '').slice(0, 200),
    };
  }
}

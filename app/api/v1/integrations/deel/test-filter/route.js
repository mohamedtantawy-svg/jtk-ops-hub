// ── GET /api/v1/integrations/deel/test-filter ───────────────────────────────
// TEMPORARY — probes which filter param shapes `terminations_v3` accepts.
// Owner-gated so it can't leak in production traffic. Remove once we've
// landed the proper server-side filter on listOffboardingCases().
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { deelFetch } from '../../../../../../src/lib/deel-api';

const OWNER_EMAIL = 'mohamed.tantawy@deel.com';

const PROBES = [
  // The shape the Deel admin UI itself uses in its URL bar (status[]=CANCELLED).
  { name: 'status[]=AWAITING_TRIAGE', q: 'limit=5&status%5B%5D=AWAITING_TRIAGE' },
  { name: 'status[]=CANCELLED',       q: 'limit=5&status%5B%5D=CANCELLED' },
  { name: 'status[]=COMPLETED',       q: 'limit=5&status%5B%5D=COMPLETED' },
  { name: 'two-status[]',             q: 'limit=5&status%5B%5D=AWAITING_TRIAGE&status%5B%5D=PROCESSING' },
  // Singular shapes
  { name: 'status=AWAITING_TRIAGE',   q: 'limit=5&status=AWAITING_TRIAGE' },
  { name: 'statuses=...',             q: 'limit=5&statuses=AWAITING_TRIAGE,PROCESSING' },
  // Bracket variants
  { name: 'statuses[]=...',           q: 'limit=5&statuses%5B%5D=AWAITING_TRIAGE' },
  { name: 'filter[status]=...',       q: 'limit=5&filter%5Bstatus%5D=AWAITING_TRIAGE' },
  // Date / archive cutoffs
  { name: 'isArchived=false',         q: 'limit=5&isArchived=false' },
  { name: 'createdAfter=2024-01-01',  q: 'limit=5&createdAfter=2024-01-01' },
  // Baseline (no filter, just to confirm endpoint still works)
  { name: 'baseline (no filter)',     q: 'limit=5' },
];

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.email.toLowerCase() !== OWNER_EMAIL) {
    return NextResponse.json({ error: 'Forbidden — owner-gated' }, { status: 403 });
  }

  const out = [];
  for (const p of PROBES) {
    const startedAt = Date.now();
    try {
      const res = await deelFetch(`/admin/eor/terminations_v3?${p.q}`);
      const elapsed = Date.now() - startedAt;
      out.push({
        name: p.name,
        ok: true,
        elapsed,
        total: res?.count?.total ?? null,
        gotPage: Array.isArray(res?.terminations) ? res.terminations.length : null,
        cursorHasMore: !!res?.cursor,
        // Sample first item's status to confirm the filter actually applied.
        firstStatus: res?.terminations?.[0]?.status || null,
      });
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      out.push({
        name: p.name,
        ok: false,
        elapsed,
        status: err.status || null,
        // Truncated, no auth/cookie data — just the upstream Joi message.
        message: (err.message || '').slice(0, 240),
      });
    }
  }

  return NextResponse.json({ probes: out, ranAt: new Date().toISOString() });
}

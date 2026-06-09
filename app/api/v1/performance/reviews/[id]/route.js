// ── /api/v1/performance/reviews/[id] ─────────────────────────────────────────
// GET   — one review (caller must be able to view the member, org-tree scoped).
// PATCH — edit a review: re-score (manager: evalAnswers/kpiPoints/sentiment/
//         promotion → recompute), merge check-in (member self or manager),
//         status transitions (submit / finalize+lock / acknowledge). A locked
//         review only accepts acknowledge unless the caller is a perf-admin
//         (who can reopen).
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../src/lib/db';
import { canAdministerPerformance } from '../../../../../../src/lib/performance-admin';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import {
  canViewMemberPerf, canScoreMemberPerf, scoreEvaluation,
} from '../../../../../../src/lib/performance-helpers';
import { REVIEW_STATUS_KEYS } from '../../../../../../src/lib/performance-constants';

function reviewToClient(r) {
  return {
    id: r.id, orgNodeId: r.org_node_id, cycleId: r.cycle_id,
    periodMonth: r.period_month, periodYear: r.period_year,
    memberEmail: r.member_email, memberName: r.member_name,
    managerEmail: r.manager_email, managerName: r.manager_name, roleKey: r.role_key,
    templateId: r.template_id, templateVersion: r.template_version,
    sentiment: r.sentiment != null ? Number(r.sentiment) : null,
    operations: r.operations != null ? Number(r.operations) : null,
    kpi: r.kpi != null ? Number(r.kpi) : null,
    growth: r.growth != null ? Number(r.growth) : null,
    kpiPoints: r.kpi_points != null ? Number(r.kpi_points) : null,
    weightedScore: r.weighted_score != null ? Number(r.weighted_score) : null,
    overallScore: r.overall_score != null ? Number(r.overall_score) : null,
    band: r.band, promotion: r.promotion,
    evalAnswers: r.eval_answers || {}, checkin: r.checkin || {},
    status: r.status, isLocked: r.is_locked, source: r.source,
    finalizedAt: r.finalized_at, acknowledgedAt: r.acknowledged_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

async function loadReview(id) {
  const { rows } = await query('SELECT * FROM perf_reviews WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();
  const { id } = await params;
  try {
    const r = await loadReview(id);
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const isSelf = r.member_email.toLowerCase() === user.email.toLowerCase();
    if (!isSelf && !canViewMemberPerf(user, r.member_email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ review: reviewToClient(r) });
  } catch (err) {
    console.error('[performance/reviews/[id] GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();
  const { id } = await params;
  try {
    const r = await loadReview(id);
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const me = user.email.toLowerCase();
    const isSelf = r.member_email.toLowerCase() === me;
    const isPerfAdmin = await canAdministerPerformance(user);
    const canScore = canScoreMemberPerf(user, r.member_email, isPerfAdmin);
    if (!isSelf && !canScore) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const wantsScoreEdit = canScore && (body.evalAnswers || body.kpiPoints != null || body.sentiment != null || body.promotion != null);
    // Locked guard: only acknowledge passes once locked, unless perf-admin reopens.
    if (r.is_locked && !isPerfAdmin) {
      const onlyAck = body.status === 'acknowledged' && Object.keys(body).every(k => k === 'status');
      if (!onlyAck) return NextResponse.json({ error: 'Review is locked' }, { status: 409 });
    }

    const sets = []; const values = [];
    const push = (frag, val) => { values.push(val); sets.push(frag.replace('$$', `$${values.length}`)); };

    // Manager re-scoring → recompute via the template.
    if (wantsScoreEdit) {
      let tpl = null;
      if (r.template_id) {
        const t = await query('SELECT * FROM perf_templates WHERE id = $1 LIMIT 1', [r.template_id]);
        tpl = t.rows[0] || null;
      }
      const evalAnswers = body.evalAnswers || r.eval_answers || {};
      const kpiPoints = body.kpiPoints != null ? Number(body.kpiPoints) : (r.kpi_points != null ? Number(r.kpi_points) : 0);
      const s = scoreEvaluation({ template: tpl || {}, evalAnswers, kpiPoints });
      push('eval_answers = $$::jsonb', JSON.stringify(evalAnswers));
      push('kpi_points = $$', kpiPoints);
      push('operations = $$', s.operations);
      push('kpi = $$', s.kpi);
      push('growth = $$', s.growth);
      push('weighted_score = $$', s.weighted);
      push('overall_score = $$', s.overall);
      push('band = $$', s.band);
      if (body.sentiment != null) push('sentiment = $$', Number(body.sentiment));
      if (typeof body.promotion === 'string') push('promotion = $$', body.promotion);
    }
    // Check-in merge (member self or manager).
    if (body.checkin && typeof body.checkin === 'object') {
      push(`checkin = COALESCE(checkin,'{}'::jsonb) || $$::jsonb`, JSON.stringify(body.checkin));
    }
    // Status transitions — a self (non-scorer) caller may only move their own
    // review to member_input (submit reflection) or acknowledged; advancing to
    // manager_review / finalized / draft requires scoring rights.
    if (typeof body.status === 'string' && REVIEW_STATUS_KEYS.has(body.status)) {
      const selfAllowed = body.status === 'member_input' || body.status === 'acknowledged';
      if (canScore || selfAllowed) {
        push('status = $$', body.status);
        if (body.status === 'finalized' && canScore) {
          sets.push('finalized_at = NOW()');
          push('finalized_by_email = $$', me);
          sets.push('is_locked = true');
        }
        if (body.status === 'acknowledged' && (isSelf || canScore)) sets.push('acknowledged_at = NOW()');
      }
    }
    // Perf-admin reopen (unlock).
    if (body.reopen === true && isPerfAdmin) { sets.push('is_locked = false'); }

    if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    push('updated_by_email = $$', me);
    sets.push('updated_at = NOW()');
    values.push(id);
    const { rows } = await query(
      `UPDATE perf_reviews SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    return NextResponse.json({ review: reviewToClient(rows[0]) });
  } catch (err) {
    console.error('[performance/reviews/[id] PATCH]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

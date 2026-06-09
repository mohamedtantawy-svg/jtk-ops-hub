// ── /api/v1/performance/reviews ──────────────────────────────────────────────
// GET  — reviews visible to the caller (org-tree scoped). ?scope=mine|team|all,
//        ?month=&year=, ?member=<email>. For scope=team+period, also returns a
//        roster of the caller's reports with each one's review status (so the
//        team queue can show "not started"). Everyone may read their OWN; only
//        the tree above a member sees theirs.
// POST — create/score a review for a member+period. Manager (or perf-admin)
//        provides eval answers + KPI points → server computes the scores via
//        the scoring engine. A member may upsert only their own check-in.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';
import { canAdministerPerformance } from '../../../../../src/lib/performance-admin';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import { MEMBERS_BY_EMAIL } from '../../../../../src/data/members';
import {
  visiblePerfEmails, canViewMemberPerf, canScoreMemberPerf, resolveMemberContext, scoreEvaluation,
} from '../../../../../src/lib/performance-helpers';
import { isManagerialRole } from '../../../../../src/lib/performance-constants';

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

// Find the active template for a member's role within a dept (fallback: any
// active template for the dept). Returns the full template row or null.
async function resolveTemplate(orgNodeId, roleKey) {
  try {
    const byRole = await query(
      `SELECT * FROM perf_templates WHERE is_archived = false AND is_active = true
         AND ($1::uuid IS NULL OR org_node_id = $1) AND role_key = $2
       ORDER BY version DESC LIMIT 1`, [orgNodeId || null, roleKey || '']);
    if (byRole.rows[0]) return byRole.rows[0];
    const any = await query(
      `SELECT * FROM perf_templates WHERE is_archived = false AND is_active = true
         AND ($1::uuid IS NULL OR org_node_id = $1) ORDER BY version DESC LIMIT 1`, [orgNodeId || null]);
    return any.rows[0] || null;
  } catch { return null; }
}

async function ensureCycle(orgNodeId, month, year) {
  if (!orgNodeId) return null;
  try {
    const { rows } = await query(
      `INSERT INTO perf_cycles (org_node_id, period_month, period_year)
       VALUES ($1, $2, $3) ON CONFLICT (org_node_id, period_month, period_year) DO NOTHING
       RETURNING id`, [orgNodeId, month, year]);
    if (rows[0]) return rows[0].id;
    const ex = await query(
      `SELECT id FROM perf_cycles WHERE org_node_id=$1 AND period_month=$2 AND period_year=$3 LIMIT 1`,
      [orgNodeId, month, year]);
    return ex.rows[0]?.id || null;
  } catch { return null; }
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();
  try {
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') || 'mine';
    const month = searchParams.get('month') ? Number(searchParams.get('month')) : null;
    const year = searchParams.get('year') ? Number(searchParams.get('year')) : null;
    const member = (searchParams.get('member') || '').toLowerCase();
    const me = user.email.toLowerCase();
    const isPerfAdmin = await canAdministerPerformance(user);
    const isMgr = isManagerialRole(user.role) || isPerfAdmin;

    // Resolve the visible email set for this caller.
    let visible;
    if (member) {
      if (!canViewMemberPerf(user, member) && member !== me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      visible = new Set([member]);
    } else if (scope === 'mine' || !isMgr) {
      visible = new Set([me]);
    } else {
      visible = visiblePerfEmails(user);   // team/all → tree scope
    }
    const emails = [...visible];
    if (emails.length === 0) return NextResponse.json({ reviews: [], roster: [] });

    const params = [emails];
    let where = 'LOWER(member_email) = ANY($1::text[])';
    if (month) { params.push(month); where += ` AND period_month = $${params.length}`; }
    if (year) { params.push(year); where += ` AND period_year = $${params.length}`; }
    const { rows } = await query(
      `SELECT * FROM perf_reviews WHERE ${where} ORDER BY period_year DESC, period_month DESC, member_name ASC`,
      params);
    const reviews = rows.map(reviewToClient);

    // Team roster (status per report) when a manager asks for a specific period.
    let roster = [];
    if (scope === 'team' && isMgr && month && year && !member) {
      const byMember = new Map(reviews.filter(r => r.periodMonth === month && r.periodYear === year).map(r => [r.memberEmail.toLowerCase(), r]));
      roster = emails.filter(e => e !== me).map(e => {
        const m = MEMBERS_BY_EMAIL[e] || {};
        const rv = byMember.get(e) || null;
        return {
          email: e, name: m.name || e, role: m.access || m.role || '', title: m.title || '',
          status: rv ? rv.status : 'not_started',
          overallScore: rv ? rv.overallScore : null,
          band: rv ? rv.band : null,
          reviewId: rv ? rv.id : null,
        };
      });
    }
    return NextResponse.json({ reviews, roster });
  } catch (err) {
    console.error('[performance/reviews GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();
  try {
    const body = await req.json().catch(() => ({}));
    const memberEmail = String(body.memberEmail || '').toLowerCase();
    const month = Number(body.month), year = Number(body.year);
    if (!memberEmail || !(month >= 1 && month <= 12) || !(year >= 2020)) {
      return NextResponse.json({ error: 'memberEmail, month (1–12), year are required' }, { status: 400 });
    }
    const isPerfAdmin = await canAdministerPerformance(user);
    const canScore = canScoreMemberPerf(user, memberEmail, isPerfAdmin);
    const isSelf = memberEmail === user.email.toLowerCase();
    if (!canScore && !isSelf) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const ctx = resolveMemberContext(memberEmail);
    const deptId = ctx.orgNodeId || await getCurrentDeptId(user, req);
    const cycleId = await ensureCycle(deptId, month, year);

    // Scoring (manager path only — a self-only upsert never sets scores).
    let scored = {};
    let templateId = null, templateVersion = null, roleKey = ctx.role || null;
    if (canScore && (body.evalAnswers || body.kpiPoints != null)) {
      const tpl = await resolveTemplate(deptId, ctx.role);
      if (tpl) { templateId = tpl.id; templateVersion = tpl.version; roleKey = tpl.role_key; }
      const s = scoreEvaluation({ template: tpl || {}, evalAnswers: body.evalAnswers || {}, kpiPoints: Number(body.kpiPoints) || 0 });
      scored = { operations: s.operations, kpi: s.kpi, growth: s.growth, weighted: s.weighted, overall: s.overall, band: s.band };
    }
    const sentiment = (canScore && body.sentiment != null) ? Number(body.sentiment) : null;
    const promotion = (canScore && typeof body.promotion === 'string') ? body.promotion : 'no';
    const checkin = (body.checkin && typeof body.checkin === 'object') ? body.checkin : {};
    const status = canScore ? (body.status || 'manager_review') : 'member_input';

    const { rows } = await query(
      `INSERT INTO perf_reviews
         (org_node_id, cycle_id, period_month, period_year, member_email, member_name, member_id,
          manager_email, manager_name, role_key, template_id, template_version,
          sentiment, operations, kpi, growth, kpi_points, weighted_score, overall_score, band, promotion,
          eval_answers, checkin, status, source, created_by_email, updated_by_email)
       VALUES ($1,$2,$3,$4,$5,$6,
               (SELECT id FROM members WHERE LOWER(email)=$5 LIMIT 1),
               $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23,'app',$24,$24)
       ON CONFLICT (member_email, period_month, period_year) DO UPDATE SET
         operations = COALESCE(EXCLUDED.operations, perf_reviews.operations),
         kpi = COALESCE(EXCLUDED.kpi, perf_reviews.kpi),
         growth = COALESCE(EXCLUDED.growth, perf_reviews.growth),
         kpi_points = COALESCE(EXCLUDED.kpi_points, perf_reviews.kpi_points),
         sentiment = COALESCE(EXCLUDED.sentiment, perf_reviews.sentiment),
         weighted_score = COALESCE(EXCLUDED.weighted_score, perf_reviews.weighted_score),
         overall_score = COALESCE(EXCLUDED.overall_score, perf_reviews.overall_score),
         band = COALESCE(EXCLUDED.band, perf_reviews.band),
         promotion = CASE WHEN $25 THEN EXCLUDED.promotion ELSE perf_reviews.promotion END,
         eval_answers = CASE WHEN $25 THEN EXCLUDED.eval_answers ELSE perf_reviews.eval_answers END,
         checkin = COALESCE(perf_reviews.checkin,'{}'::jsonb) || EXCLUDED.checkin,
         template_id = COALESCE(EXCLUDED.template_id, perf_reviews.template_id),
         template_version = COALESCE(EXCLUDED.template_version, perf_reviews.template_version),
         status = EXCLUDED.status, updated_by_email = EXCLUDED.updated_by_email, updated_at = NOW()
       RETURNING *`,
      [
        deptId, cycleId, month, year, memberEmail, ctx.memberName || body.memberName || memberEmail,
        ctx.managerEmail || null, ctx.managerName || null, roleKey, templateId, templateVersion,
        sentiment, scored.operations ?? null, scored.kpi ?? null, scored.growth ?? null,
        (canScore && body.kpiPoints != null) ? Number(body.kpiPoints) : null,
        scored.weighted ?? null, scored.overall ?? null, scored.band ?? null, promotion,
        JSON.stringify(canScore ? (body.evalAnswers || {}) : {}), JSON.stringify(checkin), status,
        user.email.toLowerCase(), canScore,
      ]);
    return NextResponse.json({ review: reviewToClient(rows[0]) }, { status: 201 });
  } catch (err) {
    console.error('[performance/reviews POST]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── /api/v1/hr-hub/requests/counts ─────────────────────────────────────────
// Server-side COUNT(*) for the HR Hub view's status cards + scope pills, in
// one round trip. Replaces the two `listHrHubRequests({ limit: 100 })`
// calls HrHubView used to make — those counted a TRUNCATED list array
// (the list route caps at 100), so once the workspace crossed ~100 rows
// the totals stopped reflecting reality. Mohamed Tantawy 2026-05-22
// caught it on HR Experience: the New + Resolved cards summed to exactly
// 100 even though many more historical rows existed.
//
// Returns:
//   {
//     byStatus: { new, in_progress, on_hold, resolved, rejected, total },
//     byScope:  { all, mine, team, assigned, mentioned }   // pending only
//                                                          // (excludes resolved + rejected,
//                                                          // matching the 2026-05-04 spec)
//   }
//
// byStatus respects the caller's current scope/flow/search filters so the
// 5 status cards reflect "what would I see in this view".
// byScope is pending-only and ignores scope (since each pill IS its own
// scope) but still honours flow + search so the badges narrow with the
// caller's filter bar selection.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { getVisibleEmailsForAccess } from '../../../../../../src/data/members';
import { getCurrentDeptId } from '../../../../../../src/lib/dept-scope';
import { memberByEmail } from '../../../../../../src/lib/hr-hub-helpers';

const ALLOWED_FLOWS = new Set(['hr_request', 'hr_reporting', 'escalation_zero', 'feedback', 'hide_task_request', 'sla_extension_request']);
const ALLOWED_SCOPES = new Set(['mine', 'team', 'all', 'assigned', 'mentioned']);
const ALL_STATUSES = ['new', 'in_progress', 'on_hold', 'resolved', 'rejected'];

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  const { searchParams } = new URL(req.url);
  const flow = searchParams.get('flow');
  const scope = searchParams.get('scope') || 'mine';
  const search = searchParams.get('search');
  // 2026-05-22 — accept `flows=a,b` for multi-flow filters (briefing tile
  // for SLA Extension & Hide-Task needs both `hide_task_request` and
  // `sla_extension_request`). Single-value `flow=` stays back-compat.
  const flowsParam = searchParams.get('flows');
  const flowList = flowsParam
    ? flowsParam.split(',').map(s => s.trim()).filter(Boolean)
    : (flow ? [flow] : []);

  if (!ALLOWED_SCOPES.has(scope)) {
    return NextResponse.json({ error: `Invalid scope: ${scope}` }, { status: 400 });
  }
  for (const f of flowList) {
    if (!ALLOWED_FLOWS.has(f)) {
      return NextResponse.json({ error: `Invalid flow: ${f}` }, { status: 400 });
    }
  }

  const callerEmail = String(user.email).toLowerCase();
  const callerMember = memberByEmail(callerEmail);
  const isManager = callerMember && (callerMember.access === 'team_lead' || callerMember.access === 'regional_manager' || callerMember.access === 'admin');
  const effectiveScope = (scope === 'team' && !isManager) ? 'mine' : scope;

  // Same dept-isolation gate as the list endpoint — missing dept fails
  // closed (zero counts) instead of leaking another dept's rows.
  const currentDeptId = await getCurrentDeptId(user, req);

  // Shared base filters: dept + flow + search. Applied to BOTH queries
  // verbatim so the two responses share the same row universe.
  const baseFilters = [];
  const baseParams = [];
  let p = 1;
  if (currentDeptId) {
    baseFilters.push(`org_node_id = $${p++}`);
    baseParams.push(currentDeptId);
  } else {
    baseFilters.push(`FALSE`);
  }
  if (flowList.length === 1) {
    baseFilters.push(`flow = $${p++}`);
    baseParams.push(flowList[0]);
  } else if (flowList.length > 1) {
    baseFilters.push(`flow = ANY($${p++}::text[])`);
    baseParams.push(flowList);
  }
  if (search) {
    baseFilters.push(`(LOWER(summary) LIKE $${p} OR LOWER(COALESCE(title,'')) LIKE $${p})`);
    baseParams.push(`%${String(search).toLowerCase()}%`);
    p++;
  }
  const baseWhereSql = baseFilters.length ? `WHERE ${baseFilters.join(' AND ')}` : '';

  // ── byStatus: counts the 5 status buckets under the caller's CURRENT
  // scope. Same scope-mapping as the list route (mine = creator,
  // assigned = assignee, team = manager subtree, mentioned = @-tag in
  // a live comment, all = no extra predicate).
  const statusFilters = [...baseFilters];
  const statusParams = [...baseParams];
  let sp = p;

  if (effectiveScope === 'mine') {
    statusFilters.push(`LOWER(created_by_email) = $${sp++}`);
    statusParams.push(callerEmail);
  } else if (effectiveScope === 'assigned') {
    statusFilters.push(`LOWER(assignee_email) = $${sp++}`);
    statusParams.push(callerEmail);
  } else if (effectiveScope === 'mentioned') {
    statusFilters.push(`EXISTS (
      SELECT 1 FROM hr_hub_comment c
       WHERE c.request_id = hr_hub_request.id
         AND c.deleted_at IS NULL
         AND $${sp++} = ANY(c.mention_emails)
    )`);
    statusParams.push(callerEmail);
  } else if (effectiveScope === 'team') {
    const visible = getVisibleEmailsForAccess(callerEmail);
    const teamEmails = Array.from(visible).filter(e => e && e !== callerEmail);
    if (teamEmails.length === 0) {
      statusFilters.push(`FALSE`);
    } else {
      statusFilters.push(`LOWER(created_by_email) = ANY($${sp++}::text[])`);
      statusParams.push(teamEmails);
    }
  }
  // 'all' → no extra predicate (rule 1: every user has full read access).

  const statusWhereSql = `WHERE ${statusFilters.join(' AND ')}`;
  const statusSql = `
    SELECT status, COUNT(*)::int AS n
      FROM hr_hub_request
      ${statusWhereSql}
     GROUP BY status`;

  // ── byScope: pending-only counts (excludes resolved + rejected) for
  // EVERY scope, computed in a single conditional-aggregate pass so the
  // pill badges populate without 5 separate round-trips. Doesn't apply
  // the caller's current scope filter — each pill *is* a different scope.
  const visibleEmails = getVisibleEmailsForAccess(callerEmail);
  const teamEmails = Array.from(visibleEmails).filter(e => e && e !== callerEmail);
  const teamHasReports = teamEmails.length > 0;
  // 2026-05-22 — Mohamed Tantawy spec: Briefing strip's HR Hub / SLA
  // Extension tiles surface a role-scoped count that's NOT one of the
  // existing scope pills. Compute it here so the FE doesn't have to
  // re-union two queries client-side (the old approach was 6 list calls
  // per tile, capped at 100 each — admin counts were truncated for any
  // busy dept).
  //   • Admin            → everything in the dept (no extra predicate).
  //   • RM / TL          → raised by anyone in the subtree (incl. self) OR
  //                        assigned to caller — i.e. anything I need to
  //                        watch as a manager.
  //   • Team Member      → raised by me OR assigned to me.
  // Same union semantics for the SLA Extension tile when `flows=` narrows
  // the row universe to hide_task_request + sla_extension_request.
  const callerAccess = (callerMember?.access || '').toLowerCase();
  const isAdminCaller = callerAccess === 'admin';
  const isManagerCaller = callerAccess === 'team_lead' || callerAccess === 'regional_manager' || isAdminCaller;

  const scopeParams = [...baseParams];
  let kp = p;
  const callerPlaceholder = `$${kp++}`;
  scopeParams.push(callerEmail);
  const teamArrayPlaceholder = teamHasReports ? `$${kp++}::text[]` : null;
  if (teamHasReports) scopeParams.push(teamEmails);

  // briefingTile filter expression keyed off caller's role. Admins land
  // on TRUE (= the unfiltered pending universe = all_count). Managers OR
  // the subtree-created predicate with the assigned-to-caller predicate.
  // Agents fold to created_by=caller OR assignee=caller.
  let briefingTileFilter;
  if (isAdminCaller) {
    briefingTileFilter = 'TRUE';
  } else if (isManagerCaller && teamHasReports) {
    // Manager with reports: union of subtree (incl. self) + assigned.
    briefingTileFilter = `(LOWER(created_by_email) = ANY(${teamArrayPlaceholder}) OR LOWER(created_by_email) = ${callerPlaceholder} OR LOWER(assignee_email) = ${callerPlaceholder})`;
  } else {
    // Manager with empty subtree OR agent — created_by=caller OR assigned.
    briefingTileFilter = `(LOWER(created_by_email) = ${callerPlaceholder} OR LOWER(assignee_email) = ${callerPlaceholder})`;
  }

  const scopeSql = `
    WITH pending AS (
      SELECT id, created_by_email, assignee_email,
             EXISTS (
               SELECT 1 FROM hr_hub_comment c
                WHERE c.request_id = hr_hub_request.id
                  AND c.deleted_at IS NULL
                  AND ${callerPlaceholder} = ANY(c.mention_emails)
             ) AS mentioned_me
        FROM hr_hub_request
        ${baseWhereSql}
         ${baseWhereSql ? 'AND' : 'WHERE'} status NOT IN ('resolved', 'rejected')
    )
    SELECT
      COUNT(*)::int                                                                                AS all_count,
      COUNT(*) FILTER (WHERE LOWER(created_by_email) = ${callerPlaceholder})::int                  AS mine_count,
      COUNT(*) FILTER (WHERE LOWER(assignee_email) = ${callerPlaceholder})::int                    AS assigned_count,
      ${teamHasReports
        ? `COUNT(*) FILTER (WHERE LOWER(created_by_email) = ANY(${teamArrayPlaceholder}))::int    AS team_count,`
        : `0::int                                                                                  AS team_count,`}
      COUNT(*) FILTER (WHERE mentioned_me)::int                                                    AS mentioned_count,
      COUNT(*) FILTER (WHERE ${briefingTileFilter})::int                                           AS briefing_tile_count
    FROM pending`;

  const [{ rows: statusRows }, { rows: scopeRows }] = await Promise.all([
    query(statusSql, statusParams),
    query(scopeSql, scopeParams),
  ]);

  const byStatus = { new: 0, in_progress: 0, on_hold: 0, resolved: 0, rejected: 0, total: 0 };
  for (const r of statusRows) {
    if (ALL_STATUSES.includes(r.status)) byStatus[r.status] = Number(r.n) || 0;
    byStatus.total += Number(r.n) || 0;
  }

  const sRow = scopeRows[0] || { all_count: 0, mine_count: 0, assigned_count: 0, team_count: 0, mentioned_count: 0, briefing_tile_count: 0 };
  const byScope = {
    all:          Number(sRow.all_count)           || 0,
    mine:         Number(sRow.mine_count)          || 0,
    assigned:     Number(sRow.assigned_count)      || 0,
    team:         Number(sRow.team_count)          || 0,
    mentioned:    Number(sRow.mentioned_count)     || 0,
    // Role-scoped union for the Briefing strip tile. See briefingTileFilter
    // construction above for the exact predicate per role.
    briefingTile: Number(sRow.briefing_tile_count) || 0,
  };

  return NextResponse.json({ byStatus, byScope });
}

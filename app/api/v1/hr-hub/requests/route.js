// ── /api/v1/hr-hub/requests ─────────────────────────────────────────────────
// GET  — paginated list of requests across all flows or a single flow,
//        scoped by `?scope=mine|team|all` (default: mine). Filters: status,
//        function_area, search. Cursor pagination on (created_at, id).
// POST — create a new request in any flow. Mirrors the field map seeded
//        in hr_hub_settings; cross-field validation runs against that map
//        so admins can change required fields without touching this code.
//
// Rules enforced here (HR_HUB_PLAN.md):
//   1. Every authenticated user can read + write → no role gate on read.
//   2. The "All" scope returns the full set (rule 1: full access).
//   3. The "Team" scope is only meaningful for managers (TL/RM) — for
//      agents we collapse it to `mine`.
//   8. Notifications fired on assignment / status change in PATCH (in
//      [id]/route.js); creation just writes the creator follower + log.
//   9. Every state-changing call writes hr_hub_log.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import { getVisibleEmailsForAccess } from '../../../../../src/data/members';
import { getCurrentDeptSlugAndId, getEffectiveDeptIdsForUser } from '../../../../../src/lib/dept-scope';
import { readDeptSettingRow } from '../../../../../src/lib/dept-settings';
import {
  memberByEmail,
  managerEmailFor,
  teamLeadEmailFor,
  addFollower,
  writeLog,
} from '../../../../../src/lib/hr-hub-helpers';
import { resolveAssigneeWithOooCover, reconcileOooCovers } from '../../../../../src/lib/hr-hub-ooo';
import {
  ALLOWED_TASK_SOURCES as ALLOWED_SLA_EXT_TASK_SOURCES,
  ALLOWED_REASON_CODES as ALLOWED_SLA_EXT_REASON_CODES,
  ALLOWED_REQUESTED_DAYS as ALLOWED_SLA_EXT_REQUESTED_DAYS,
  findActiveExtension,
  insertSlaExtension,
} from '../../../../../src/lib/sla-extension-helpers';
import { cacheDel } from '../../../../../src/lib/server-cache';

const ALLOWED_FLOWS = new Set(['hr_request', 'hr_reporting', 'escalation_zero', 'feedback', 'hide_task_request', 'sla_extension_request', 'payment_refund']);
const ALLOWED_HIDE_REASON_CODES = new Set(['internal_deel_employee', 'test_task', 'other']);
const ALLOWED_STATUSES = new Set(['new', 'in_progress', 'on_hold', 'pending_requester', 'resolved', 'rejected']);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

// SLA extensions of 1–2 business days are low-risk and auto-approved on
// submit — they skip manager review entirely (Mohamed 2026-06-04). Longer
// holds (3–7 days) still route to the requester's manager. Kept in lockstep
// with AUTO_APPROVE_MAX_DAYS in src/components/modals/CreateSlaExtensionModal.jsx
// (the FE indicator) — if you tune one, tune both.
const SLA_EXT_AUTO_APPROVE_MAX_DAYS = 2;
// `assigned` = items where assignee_email matches the caller. Distinct from
// `mine` (which keys off created_by_email) — a manager who triages a request
// they didn't submit needs the "Assigned to me" filter to surface it.
// `mentioned` = items where the caller's email appears in any non-deleted
// comment's mention_emails array. Ewa K. 2026-05-15 feedback: mentions in
// HR Hub were only discoverable via the bell or by opening every request;
// surfacing them as a dedicated scope mirrors Slack's "Mentions" tab so
// users can audit "what was I tagged into" in one queue.
const ALLOWED_SCOPES = new Set(['mine', 'team', 'all', 'assigned', 'mentioned']);

// Same caps as the existing Feedback route — keeps the migration in
// Stage 5 a straight shape-match. Tweak in one place across both routes
// if we ever raise the limit.
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_PAYLOAD_BYTES = 30 * 1024 * 1024;
const ATTACHMENT_KINDS = new Set(['image', 'video', 'pdf']);
const ATTACHMENT_PREFIX_BY_KIND = {
  image: 'data:image/',
  video: 'data:video/',
  pdf: 'data:application/pdf',
};

function clean(str, max) {
  if (typeof str !== 'string') return null;
  const t = str.trim();
  if (!t) return null;
  return max && t.length > max ? t.slice(0, max) : t;
}

function sanitiseAttachments(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('attachments must be an array');
  if (raw.length > MAX_ATTACHMENTS) {
    throw Object.assign(new Error(`Too many attachments (max ${MAX_ATTACHMENTS})`), { status: 413 });
  }
  let total = 0;
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const kind = ATTACHMENT_KINDS.has(a.kind) ? a.kind : null;
    const dataUri = typeof a.dataUri === 'string' ? a.dataUri : null;
    if (!kind || !dataUri) continue;
    const expected = ATTACHMENT_PREFIX_BY_KIND[kind];
    if (!expected || !dataUri.startsWith(expected)) continue;
    if (dataUri.length > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(
        new Error(`Attachment "${a.name || kind}" too large (max ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB)`),
        { status: 413 },
      );
    }
    total += dataUri.length;
    if (total > MAX_TOTAL_PAYLOAD_BYTES) {
      throw Object.assign(
        new Error(`Total attachment payload too large (max ${Math.round(MAX_TOTAL_PAYLOAD_BYTES / 1024 / 1024)} MB)`),
        { status: 413 },
      );
    }
    out.push({
      kind,
      dataUri,
      name: typeof a.name === 'string' ? a.name.slice(0, 200) : null,
    });
  }
  return out;
}

function sanitiseLinks(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const u of raw) {
    if (typeof u !== 'string') continue;
    const t = u.trim();
    if (!t) continue;
    if (t.length > 2000) continue;
    if (!/^https?:\/\//i.test(t)) continue;
    out.push(t);
    if (out.length >= 25) break;
  }
  return out;
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();
  // 2026-05-22 — flip any rows whose OOO-covered original is now back.
  // Throttled to one run per minute at the module level, so a busy
  // workspace with dozens of list calls per minute only pays the cost
  // once. Awaited so the rows we return reflect the most-recent state
  // — the user shouldn't see "still covered by manager" 30s after the
  // original logged in.
  await reconcileOooCovers();

  const { searchParams } = new URL(req.url);
  const flow = searchParams.get('flow');
  // Megan Lawrence 2026-05-28 — accept `flows=a,b` for the Approvals chip
  // (Hide Task + SLA Extension shortcut). Mirrors the counts route which
  // has supported this since the Briefing tile combined-count work. Single
  // `flow=` stays back-compat; both can't be set at the same time.
  const flowsParam = searchParams.get('flows');
  const flowList = flowsParam
    ? flowsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : (flow ? [flow] : []);
  const scope = searchParams.get('scope') || 'mine';
  const status = searchParams.get('status');
  const functionArea = searchParams.get('function');
  const search = searchParams.get('search');
  const cursor = searchParams.get('cursor');
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
  // Josephine Tuoyo 2026-05-26 — assignee filter under "All Requests"
  // (and Team / Mentioned). Value is either a lowercased email, the
  // sentinel `unassigned` (matches NULL or empty assignee_email), or
  // null/empty (no extra predicate). Composes with every other scope
  // predicate so a manager can intersect "team requests" + "assigned
  // to Mauro" without re-querying.
  const assigneeRaw = searchParams.get('assignee');
  const assigneeFilter = assigneeRaw ? String(assigneeRaw).trim().toLowerCase() : null;

  if (!ALLOWED_SCOPES.has(scope)) {
    return NextResponse.json({ error: `Invalid scope: ${scope}` }, { status: 400 });
  }
  for (const f of flowList) {
    if (!ALLOWED_FLOWS.has(f)) {
      return NextResponse.json({ error: `Invalid flow: ${f}` }, { status: 400 });
    }
  }
  if (status && !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }

  const callerEmail = String(user.email).toLowerCase();
  const callerMember = memberByEmail(callerEmail);
  const isManager = callerMember && (callerMember.access === 'team_lead' || callerMember.access === 'regional_manager' || callerMember.access === 'admin');
  // Agents asking for `team` get folded into `mine` — they have no team.
  // `assigned` is available to every role — anyone can have something
  // assigned to them and needs to see their queue.
  const effectiveScope = (scope === 'team' && !isManager) ? 'mine' : scope;

  // Phase 11c (2026-05-20): hard dept isolation. Every read filters by the
  // caller's currentDeptId. HRX users resolve to HR Experience UUID via
  // dept-scope's recursive CTE; Phase 11a backfill stamped every existing
  // hr_hub_request with HR Experience, so HRX agents see identical data
  // to today. Fail-closed when no dept is resolvable (deny rather than leak).
  //
  // 2026-05-28 (Ewa feedback — global cross-dept OOO coverage policy):
  // `getEffectiveDeptIdsForUser` returns the caller's own dept PLUS the
  // top-level dept of each requester whose handover the caller is
  // currently covering. A GIX TL covering an HRX TL now sees HRX-stamped
  // requests for the duration of the OOO window — exactly the "global
  // policy across departments" Mohamed asked for. The widening is
  // automatic and time-bounded (delegations clear when end_date passes).
  const effectiveDeptIds = await getEffectiveDeptIdsForUser(user, req);

  const where = [];
  const params = [];
  let p = 1;

  // Phase 11c: dept-isolation gate — must be the first clause so a missing
  // dept (caller has no org placement) fails closed to zero rows.
  if (effectiveDeptIds.length > 0) {
    where.push(`org_node_id = ANY($${p++}::uuid[])`);
    params.push(effectiveDeptIds);
  } else {
    where.push(`FALSE`);
  }

  if (flowList.length === 1) {
    where.push(`flow = $${p++}`);
    params.push(flowList[0]);
  } else if (flowList.length > 1) {
    where.push(`flow = ANY($${p++}::text[])`);
    params.push(flowList);
  }
  if (status) { where.push(`status = $${p++}`); params.push(status); }
  if (functionArea) { where.push(`function_area = $${p++}`); params.push(functionArea); }
  if (search) {
    where.push(`(LOWER(summary) LIKE $${p} OR LOWER(COALESCE(title,'')) LIKE $${p})`);
    params.push(`%${String(search).toLowerCase()}%`);
    p++;
  }
  // Assignee filter — applied BEFORE the scope branches so it stacks with
  // scope=team / scope=all / scope=mentioned (per the 2026-05-26 spec, the
  // FE only surfaces this picker on those three scopes — mine + assigned
  // already implicitly filter by assignee, so a second filter would be
  // redundant). NULL or empty assignee_email is the "Unassigned" cohort.
  if (assigneeFilter === 'unassigned') {
    where.push(`(assignee_email IS NULL OR assignee_email = '')`);
  } else if (assigneeFilter) {
    where.push(`LOWER(assignee_email) = $${p++}`);
    params.push(assigneeFilter);
  }

  if (effectiveScope === 'mine') {
    where.push(`LOWER(created_by_email) = $${p++}`);
    params.push(callerEmail);
  } else if (effectiveScope === 'assigned') {
    where.push(`LOWER(assignee_email) = $${p++}`);
    params.push(callerEmail);
  } else if (effectiveScope === 'mentioned') {
    // Scope = "anywhere I was @-mentioned in a comment". mention_emails is
    // stored lowercase at write time by the comments POST handler, so a
    // direct ANY() match is sufficient (no LOWER() on the array element).
    // deleted_at IS NULL excludes mentions in comments that were later
    // deleted — keeps the segment focused on live tags.
    where.push(`EXISTS (
      SELECT 1 FROM hr_hub_comment c
       WHERE c.request_id = hr_hub_request.id
         AND c.deleted_at IS NULL
         AND $${p++} = ANY(c.mention_emails)
    )`);
    params.push(callerEmail);
  } else if (effectiveScope === 'team') {
    // "Team" = creator is anyone in caller's management chain (excluding
    // self — those go under 'mine'). The denormalised team_lead_email
    // column was the original primitive but it has two failure modes that
    // hid managers' team requests:
    //   (a) Org-chart drift after creation. team_lead_email is stamped at
    //       insert time; if the requester later reassigns to a different
    //       manager, the row still points at the old TL and the new
    //       manager's Team toggle returns 0.
    //   (b) Multi-hop chains for RMs. teamLeadEmailFor() returns the
    //       FIRST manager up the chain, so an agent-with-an-immediate-TL
    //       under an RM stamps the TL, never the RM. The RM's Team toggle
    //       then misses every report whose chain includes a TL hop.
    // Compute the visible set live from the hydrated roster instead:
    //   - Admin   → ALL_EMAILS_SET (effectively same as 'all')
    //   - RM      → self + transitive subtree
    //   - TL      → self + direct reports
    //   - Agent   → self only (already folded to 'mine' above, never hits
    //               this branch)
    // Excluding self keeps the segmentation clean against 'mine'.
    const visible = getVisibleEmailsForAccess(callerEmail);
    const teamEmails = Array.from(visible).filter(e => e && e !== callerEmail);
    if (teamEmails.length === 0) {
      // No reports → nothing under Team. `FALSE` keeps the SQL well-formed.
      where.push(`FALSE`);
    } else {
      where.push(`LOWER(created_by_email) = ANY($${p++}::text[])`);
      params.push(teamEmails);
    }
  }
  // 'all' → no extra predicate. Rule 1: every user has full read access.

  // Cursor format: `${ISO}|${uuid}` — keyset pagination on (created_at DESC, id DESC).
  if (cursor) {
    const [iso, id] = cursor.split('|');
    if (iso && id) {
      where.push(`(created_at, id) < ($${p++}::timestamptz, $${p++}::uuid)`);
      params.push(iso, id);
    }
  }

  // mentioned_me is a per-row boolean: true iff the caller's email appears in
  // at least one live comment's mention_emails. Cheap because the same EXISTS
  // pattern runs on every row (hr_hub_comment is indexed on request_id).
  // Driven off the SAME placeholder slot ($p) so we don't double-count
  // params; we push callerEmail once below and reference it twice in the
  // generated SQL.
  const mentionedMePlaceholder = `$${p++}`;
  params.push(callerEmail);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Lite-shape SELECT — Mohamed 2026-05-19: "very very slow to load."
  // The list endpoint used to project four heavy fields per row that the
  // row UI never reads (attachments JSONB up to ~12 MB × N per row,
  // ideal_solution TEXT, resolution_note TEXT, links JSONB). Every
  // DecisionsStrip mount fires 12 of these list calls in parallel +
  // HrHubView fires another on tab open, so the wasted bytes
  // multiply quickly.
  //
  // Same fix as PR #590 (skill mistake #45 — Feedback list disaster).
  // attachments is replaced with an in-DB length expression so we ship
  // an integer instead of the JSONB blob; ideal_solution / resolution_note
  // / links are only rendered in HrHubDetailPanel (which fetches
  // /hr-hub/requests/[id] for the full row), so they're safe to drop
  // from the list shape entirely.
  const sql = `
    SELECT id, flow, status, priority, function_area, request_type, report_type,
           title, summary,
           created_by_email, created_by_name, assignee_email, assignee_name,
           cover_for_assignee_email, cover_for_assignee_name,
           team_lead_email, cc_email, created_at, updated_at, resolved_at,
           task_source, task_id, task_url, task_subject,
           sla_ext_requested_days, sla_ext_reason_code, sla_ext_acknowledged,
           sla_ext_approved_days,
           pr_client_name, pr_amount_usd, pr_amount_local, pr_local_currency,
           COALESCE(jsonb_array_length(COALESCE(attachments, '[]'::jsonb)), 0) AS attachment_count,
           EXISTS (
             SELECT 1 FROM hr_hub_comment c
              WHERE c.request_id = hr_hub_request.id
                AND c.deleted_at IS NULL
                AND ${mentionedMePlaceholder} = ANY(c.mention_emails)
           ) AS mentioned_me
      FROM hr_hub_request
      ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${p}`;
  params.push(limit + 1);   // fetch one extra to detect "more"

  const { rows } = await query(sql, params);
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(row => ({
    id: row.id,
    flow: row.flow,
    status: row.status,
    priority: row.priority,
    functionArea: row.function_area,
    requestType: row.request_type,
    reportType: row.report_type,
    title: row.title,
    summary: row.summary,
    // ideal_solution / resolution_note / links — detail-only fields,
    // served by /api/v1/hr-hub/requests/[id]. Not projected here.
    attachmentCount: Number(row.attachment_count) || 0,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    assigneeEmail: row.assignee_email,
    assigneeName: row.assignee_name,
    // 2026-05-22 — when the row was OOO-redirected, the FE can render
    // a "covering for X (OOO)" badge so the actual assignee knows the
    // request will flip back automatically.
    coverForAssigneeEmail: row.cover_for_assignee_email,
    coverForAssigneeName: row.cover_for_assignee_name,
    teamLeadEmail: row.team_lead_email,
    ccEmail: row.cc_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    // Hide-task and SLA-extension flows — null on every other flow.
    taskSource: row.task_source,
    taskId: row.task_id,
    taskUrl: row.task_url,
    taskSubject: row.task_subject,
    // SLA-extension flow only — null on every other flow.
    slaExtRequestedDays: row.sla_ext_requested_days,
    slaExtReasonCode: row.sla_ext_reason_code,
    slaExtAcknowledged: row.sla_ext_acknowledged,
    slaExtApprovedDays: row.sla_ext_approved_days,
    // Payment Refund flow only — null on every other flow. Drives the
    // row meta line (client · $amount) on the HR Hub list.
    prClientName: row.pr_client_name,
    prAmountUsd: row.pr_amount_usd,
    prAmountLocal: row.pr_amount_local,
    prLocalCurrency: row.pr_local_currency,
    // True iff the caller is @-mentioned in any live comment. FE uses this
    // to render the "@you" pill on rows in every scope, not just under the
    // dedicated `mentioned` segment.
    mentionedMe: row.mentioned_me === true,
  }));
  const nextCursor = hasMore
    ? `${new Date(rows[limit - 1].created_at).toISOString()}|${rows[limit - 1].id}`
    : null;

  return NextResponse.json({ items, nextCursor, scope: effectiveScope });
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const flow = body.flow;
  if (!ALLOWED_FLOWS.has(flow)) {
    return NextResponse.json({ error: `Invalid flow: ${flow}` }, { status: 400 });
  }

  const summary = clean(body.summary, 20000);
  if (!summary) {
    return NextResponse.json({ error: 'summary is required' }, { status: 400 });
  }

  // Optional + flow-specific fields. Validation against the configurable
  // settings field-map is intentionally NOT enforced server-side at this
  // stage — admins can rename labels and add options without redeploying;
  // hard-coding the field requirements here would defeat that. We do
  // sanity-check the priority enum and the static constraints (status,
  // attachments shape).
  const priority = ALLOWED_PRIORITIES.has(body.priority) ? body.priority : 'medium';
  let attachments;
  try { attachments = sanitiseAttachments(body.attachments); }
  catch (err) {
    return NextResponse.json({ error: err.message || 'Invalid attachments' }, { status: err.status || 400 });
  }
  const links = sanitiseLinks(body.links);

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;
  // HR Reporting cc auto-populates from manager; other flows leave it empty.
  const ccEmail = (flow === 'hr_reporting') ? managerEmailFor(callerEmail) : null;
  // Denormalize team_lead_email for fast Team toggle queries.
  const teamLeadEmail = teamLeadEmailFor(callerEmail);

  // Hide-task flow: validate the four task_* fields. We require source +
  // id + url at minimum so the manager (and the future filter step) have
  // a stable handle on the queue row. request_type carries the reason
  // code and must be one of the three documented values.
  let taskSource = null, taskId = null, taskUrl = null, taskSubject = null;
  if (flow === 'hide_task_request') {
    taskSource = clean(body.taskSource, 40);
    taskId = clean(body.taskId, 200);
    taskUrl = clean(body.taskUrl, 2000);
    taskSubject = clean(body.taskSubject, 500);
    if (!taskSource || !taskId) {
      return NextResponse.json({ error: 'taskSource and taskId are required for hide_task_request' }, { status: 400 });
    }
    if (!ALLOWED_HIDE_REASON_CODES.has(body.requestType)) {
      return NextResponse.json({ error: `requestType must be one of: ${[...ALLOWED_HIDE_REASON_CODES].join(', ')}` }, { status: 400 });
    }
    if (body.requestType === 'other' && !summary) {
      return NextResponse.json({ error: 'summary (free-text reason) is required when requestType=other' }, { status: 400 });
    }
  }

  // SLA-extension flow: validate the four task_* identifiers PLUS the
  // flow-specific fields. Pre-check the active-extension table so a fresh
  // request can't be submitted while one is already in effect — the DB
  // partial unique index would catch a race anyway, but failing here lets
  // the FE show a clear "extension already active until <date>" message.
  let slaExtRequestedDays = null, slaExtReasonCode = null, slaExtAcknowledged = null;
  let slaExtAutoApprove = false;
  if (flow === 'sla_extension_request') {
    taskSource = clean(body.taskSource, 40);
    taskId = clean(body.taskId, 200);
    taskUrl = clean(body.taskUrl, 2000);
    taskSubject = clean(body.taskSubject, 500);
    if (!taskSource || !taskId) {
      return NextResponse.json({ error: 'taskSource and taskId are required for sla_extension_request' }, { status: 400 });
    }
    if (!ALLOWED_SLA_EXT_TASK_SOURCES.has(taskSource)) {
      return NextResponse.json({ error: `taskSource must be one of: ${[...ALLOWED_SLA_EXT_TASK_SOURCES].join(', ')}` }, { status: 400 });
    }
    const requested = Number.parseInt(body.requestedDays, 10);
    if (!ALLOWED_SLA_EXT_REQUESTED_DAYS.has(requested)) {
      return NextResponse.json({ error: `requestedDays must be one of: ${[...ALLOWED_SLA_EXT_REQUESTED_DAYS].join(', ')}` }, { status: 400 });
    }
    slaExtRequestedDays = requested;
    // 1–2 business-day holds auto-approve on submit; 3+ go to the manager.
    slaExtAutoApprove = requested <= SLA_EXT_AUTO_APPROVE_MAX_DAYS;
    if (!ALLOWED_SLA_EXT_REASON_CODES.has(body.reasonCode)) {
      return NextResponse.json({ error: `reasonCode must be one of: ${[...ALLOWED_SLA_EXT_REASON_CODES].join(', ')}` }, { status: 400 });
    }
    slaExtReasonCode = body.reasonCode;
    if (body.acknowledged !== true) {
      return NextResponse.json({ error: 'acknowledged must be true — confirm the employee/client has been informed about the hold' }, { status: 400 });
    }
    slaExtAcknowledged = true;
    // 2026-05-29 (Jose feedback): the agent-facing note is required with
    // a 20-char minimum so managers always get operational context. Mirror
    // of the FE NOTE_MIN_CHARS gate in CreateSlaExtensionModal — keep
    // them in lockstep; if you tune one tune both.
    const noteRaw = typeof body.note === 'string' ? body.note.trim() : '';
    if (noteRaw.length < 20) {
      return NextResponse.json({
        error: `note must be at least 20 characters — explain the blocker, what was tried, and the next step (got ${noteRaw.length})`,
      }, { status: 400 });
    }
    const existing = await findActiveExtension(taskSource, taskId);
    if (existing) {
      return NextResponse.json(
        { error: 'An SLA extension is already active for this task', extension: existing },
        { status: 409 },
      );
    }
    // Also block stacking pending requests for the same task — if one is
    // already in review, the user should wait or follow up on that one.
    const existingPending = await query(
      `SELECT id FROM hr_hub_request
        WHERE flow = 'sla_extension_request'
          AND task_source = $1
          AND task_id     = $2
          AND status IN ('new', 'in_progress', 'on_hold', 'pending_requester')
        LIMIT 1`,
      [taskSource, taskId],
    );
    if (existingPending.rows.length > 0) {
      return NextResponse.json(
        { error: 'An SLA extension request is already pending for this task', existingRequestId: existingPending.rows[0].id },
        { status: 409 },
      );
    }
  }

  // Payment Refund flow — validate + parse the structured intake fields.
  // The refund reason rides in `summary` (already required above), so we
  // only handle the contract link, client, and the two money amounts +
  // local currency code here. Amounts are parsed to a finite, non-negative
  // number (NUMERIC(14,2) in the DB); the contract link must be http(s)
  // like every other link in the app.
  let prContractLink = null, prClientName = null, prAmountUsd = null,
      prAmountLocal = null, prLocalCurrency = null;
  if (flow === 'payment_refund') {
    prClientName = clean(body.clientName, 255);
    prContractLink = clean(body.contractLink, 2000);
    prLocalCurrency = clean(body.localCurrency, 8);
    const usd = Number.parseFloat(body.amountUsd);
    const local = Number.parseFloat(body.amountLocal);
    if (!prClientName) {
      return NextResponse.json({ error: 'clientName is required for payment_refund' }, { status: 400 });
    }
    if (!prContractLink || !/^https?:\/\//i.test(prContractLink)) {
      return NextResponse.json({ error: 'contractLink is required and must be an http(s) URL' }, { status: 400 });
    }
    if (!Number.isFinite(usd) || usd < 0) {
      return NextResponse.json({ error: 'amountUsd must be a non-negative number' }, { status: 400 });
    }
    if (!Number.isFinite(local) || local < 0) {
      return NextResponse.json({ error: 'amountLocal must be a non-negative number' }, { status: 400 });
    }
    if (!prLocalCurrency) {
      return NextResponse.json({ error: 'localCurrency is required for payment_refund' }, { status: 400 });
    }
    prAmountUsd = usd;
    prAmountLocal = local;
    prLocalCurrency = prLocalCurrency.toUpperCase();
  }

  // Optional create-time assignee — used by the Queue → HR Hub escalation
  // flow which auto-routes to the requester's direct manager. We resolve
  // the display name from the roster so the FE doesn't need to ship one.
  let assigneeEmail = null;
  let assigneeName = null;
  if (body.assigneeEmail) {
    const lc = clean(String(body.assigneeEmail), 255)?.toLowerCase() || null;
    if (lc) {
      assigneeEmail = lc;
      assigneeName = clean(body.assigneeName, 255) || memberByEmail(lc)?.name || null;
    }
  }
  // SLA extension auto-routes to the requester's direct manager. Falls
  // back to the team lead if managerEmailFor returns nothing (e.g. an
  // agent whose TL was the only entry in the chain), and ultimately
  // leaves assignee null so HR Hub admins pick it up via the unassigned
  // pool. The FE's optional `assigneeEmail` overrides this.
  if (flow === 'sla_extension_request' && !assigneeEmail && !slaExtAutoApprove) {
    const auto = managerEmailFor(callerEmail) || teamLeadEmail || null;
    if (auto) {
      assigneeEmail = String(auto).toLowerCase();
      assigneeName = memberByEmail(assigneeEmail)?.name || null;
    }
  }

  // Resolve the submitter's department once — used both to scope the Team
  // Lead On Call auto-assignment below and to stamp org_node_id on the row
  // (Phase 11c, 2026-05-20). Isolation follows the submitter: a Payroll
  // user's request lands in Payroll's HR Hub regardless of where the assignee
  // sits. If dept resolution fails we still create the row with a null
  // org_node_id; the v1 dept-backfill picks it up on next boot.
  const { deptId: submitterDeptId, deptSlug: submitterDeptSlug } =
    (await getCurrentDeptSlugAndId(user, req)) || {};

  // Team Lead On Call auto-assignment (Mohamed 2026-05-14 spec), now per
  // department (2026-06-04). For hr_request / hr_reporting, if the caller
  // didn't pass an `assigneeEmail`, default to THIS DEPT's current Team Lead
  // On Call. `assignee_manually_set` stays FALSE so the next TLOC rotation
  // reassigns this row; an explicit PATCH of the assignee flips it to TRUE.
  let assigneeManuallySet = !!body.assigneeEmail;
  if ((flow === 'hr_request' || flow === 'hr_reporting') && !assigneeEmail) {
    try {
      const tlocRow = await readDeptSettingRow('team_lead_on_call', submitterDeptId || null, submitterDeptSlug || null);
      const tloc = tlocRow?.value || null;
      const tlocEmail = tloc?.email ? String(tloc.email).toLowerCase() : null;
      if (tlocEmail) {
        assigneeEmail = tlocEmail;
        assigneeName = tloc.name || memberByEmail(tlocEmail)?.name || null;
        assigneeManuallySet = false;
      }
    } catch (err) {
      // Best-effort: if the lookup fails, fall through to a null assignee —
      // the request still creates, just lands in the unassigned pool.
      console.warn('[hr-hub/requests] TLOC lookup failed, falling back to null assignee:', err.message);
    }
  }

  // 2026-05-22 — Jose Ruales spec: if the resolved assignee is currently
  // OOO, re-route to their first non-OOO manager and stamp the original
  // in cover_for_assignee_email. The reconciler restores them the moment
  // they're back. Applies to every HR Hub flow (hr_request, hr_reporting,
  // sla_extension_request, hide_task_request, …) across every dept.
  // `assignee_manually_set` is unaffected by the cover redirect — a
  // covered row is still considered "auto-assigned" so the TLOC rotation
  // can pick it up on the next swap, and a manual reassign still flips
  // the flag to TRUE via the [id] route's existing logic.
  let coverForEmail = null;
  let coverForName = null;
  if (assigneeEmail) {
    const resolved = await resolveAssigneeWithOooCover(assigneeEmail, assigneeName);
    assigneeEmail = resolved.assigneeEmail;
    assigneeName = resolved.assigneeName;
    coverForEmail = resolved.coverForEmail;
    coverForName = resolved.coverForName;
  }

  // Payment Refund rows have no free-text title field on the intake form
  // (the client name is the natural headline). Derive one so the row +
  // detail header read meaningfully instead of showing an empty title.
  const titleValue = flow === 'payment_refund'
    ? `Refund — ${prClientName}`.slice(0, 300)
    : clean(body.title, 300);

  const insert = await query(
    `INSERT INTO hr_hub_request
       (flow, priority,
        function_area, request_type, report_type,
        title, summary, ideal_solution,
        links, attachments,
        created_by_email, created_by_name,
        assignee_email, assignee_name,
        team_lead_email, cc_email,
        task_source, task_id, task_url, task_subject,
        sla_ext_requested_days, sla_ext_reason_code, sla_ext_acknowledged,
        assignee_manually_set,
        org_node_id,
        cover_for_assignee_email, cover_for_assignee_name,
        pr_contract_link, pr_client_name, pr_amount_usd, pr_amount_local, pr_local_currency)
     VALUES ($1, $2,
             $3, $4, $5,
             $6, $7, $8,
             $9::jsonb, $10::jsonb,
             $11, $12,
             $13, $14,
             $15, $16,
             $17, $18, $19, $20,
             $21, $22, $23,
             $24,
             $25,
             $26, $27,
             $28, $29, $30, $31, $32)
     RETURNING id, status, created_at`,
    [
      flow, priority,
      clean(body.functionArea, 80), clean(body.requestType, 80), clean(body.reportType, 80),
      titleValue, summary, clean(body.idealSolution, 20000),
      JSON.stringify(links), JSON.stringify(attachments),
      callerEmail, callerName,
      assigneeEmail, assigneeName,
      teamLeadEmail || null, ccEmail || null,
      taskSource, taskId, taskUrl, taskSubject,
      slaExtRequestedDays, slaExtReasonCode, slaExtAcknowledged,
      assigneeManuallySet,
      submitterDeptId,
      coverForEmail, coverForName,
      prContractLink, prClientName, prAmountUsd, prAmountLocal, prLocalCurrency,
    ],
  );

  const newId = insert.rows[0].id;

  // Auto-followers: creator + auto-cc (HR Reporting) + create-time
  // assignee (Queue→HR Hub escalation). All idempotent; failures here
  // don't fail the request creation itself.
  await addFollower(newId, callerEmail, 'creator');
  if (ccEmail) await addFollower(newId, ccEmail, 'tagged');
  if (assigneeEmail) await addFollower(newId, assigneeEmail, 'assignee');
  // 2026-05-22 — the OOO-covered original still follows the row so they
  // pick up the audit trail + comment stream the moment they return.
  // The reconciler reassigns the row back automatically; following keeps
  // them in the loop in the meantime.
  if (coverForEmail) await addFollower(newId, coverForEmail, 'assignee');

  await writeLog(
    newId,
    { email: callerEmail, name: callerName },
    'created',
    null,
    { flow, summary: summary.slice(0, 200), functionArea: body.functionArea, requestType: body.requestType, reportType: body.reportType },
  );
  // Audit the OOO redirect as a separate log entry so the request
  // history shows BOTH "created" and "auto_cover_assigned" — keeps the
  // signal explicit ("the system, not the requester, decided to route
  // this elsewhere because the chosen assignee is OOO").
  if (coverForEmail) {
    await writeLog(
      newId,
      { email: null, name: 'System' },
      'auto_cover_assigned',
      { assigneeEmail: coverForEmail },
      { assigneeEmail, coverForEmail, reason: 'assignee_currently_ooo' },
    );
  }

  // 1–2 business-day SLA extensions are auto-approved on submit — no manager
  // review (Mohamed 2026-06-04). This replicates the manager-approve
  // transaction in app/api/v1/sla-extension/[id]/approve/route.js: flip the
  // just-created request to resolved, insert the active sla_extension row,
  // and log it as a System auto-approval. The request row was already
  // committed above as status='new', so this runs best-effort — if it fails
  // the request simply stays 'new' and falls back to normal manager review
  // (the safest degradation).
  let autoApproved = false;
  if (slaExtAutoApprove && taskSource && taskId) {
    try {
      await withTransaction(async (client) => {
        // Revoke any expired-but-unrevoked extension for the same task so the
        // partial-unique ON CONFLICT in insertSlaExtension can accept the new
        // row (NOW() can't live in the index predicate — mirrors approve).
        await client.query(
          `UPDATE sla_extension
              SET revoked_at = NOW()
            WHERE task_source = $1 AND task_id = $2
              AND revoked_at IS NULL AND expires_at <= NOW()`,
          [taskSource, taskId],
        );
        await client.query(
          `UPDATE hr_hub_request
              SET status = 'resolved',
                  resolved_at = NOW(),
                  updated_at = NOW(),
                  sla_ext_approved_days = $2,
                  assignee_email = COALESCE(assignee_email, $3),
                  assignee_name  = COALESCE(assignee_name,  $4)
            WHERE id = $1`,
          [newId, slaExtRequestedDays, callerEmail, callerName],
        );
        const ext = await insertSlaExtension({
          taskSource,
          taskId,
          taskUrl: taskUrl || null,
          taskSubject: taskSubject || null,
          requestId: newId,
          reasonCode: slaExtReasonCode,
          requestedByEmail: callerEmail,
          requestedByName: callerName,
          approvedByEmail: callerEmail,
          approvedByName: 'Auto-approved',
          approvedDays: slaExtRequestedDays,
        }, client);
        if (!ext) {
          // A concurrent extension claimed this task between our pre-check
          // and now — abort so the txn rolls back to status='new' and the
          // request falls back to manual manager review.
          throw new Error('sla_extension insert conflicted (concurrent extension)');
        }
        await writeLog(
          newId,
          { email: null, name: 'System' },
          'sla_extension_auto_approved',
          { status: 'new', requestedDays: slaExtRequestedDays },
          { status: 'resolved', approvedDays: slaExtRequestedDays, auto: true, policy: `<=${SLA_EXT_AUTO_APPROVE_MAX_DAYS}_business_days` },
          client,
        );
      });
      autoApproved = true;
      // Bust the active-extensions list cache so the requester's queue
      // reflects the live extension on the next poll / modal-close refresh
      // instead of waiting out the 30s server cache.
      try { cacheDel('sla_extension_list'); } catch {}
    } catch (err) {
      console.warn('[hr-hub/requests] SLA auto-approval failed; request stays in manual review:', err.message);
    }
  }

  return NextResponse.json(
    autoApproved
      ? { id: newId, autoApproved: true, approvedDays: slaExtRequestedDays }
      : { id: newId },
    { status: 201 },
  );
}

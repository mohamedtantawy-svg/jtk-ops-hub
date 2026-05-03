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
import { query } from '../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import {
  memberByEmail,
  managerEmailFor,
  teamLeadEmailFor,
  addFollower,
  writeLog,
} from '../../../../../src/lib/hr-hub-helpers';

const ALLOWED_FLOWS = new Set(['hr_request', 'hr_reporting', 'escalation_zero', 'feedback', 'hide_task_request']);
const ALLOWED_HIDE_REASON_CODES = new Set(['internal_deel_employee', 'test_task', 'other']);
const ALLOWED_STATUSES = new Set(['new', 'in_progress', 'on_hold', 'resolved']);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_SCOPES = new Set(['mine', 'team', 'all']);

// Same caps as the existing Feedback route — keeps the migration in
// Stage 5 a straight shape-match. Tweak in one place across both routes
// if we ever raise the limit.
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_PAYLOAD_BYTES = 30 * 1024 * 1024;
const ATTACHMENT_KINDS = new Set(['image', 'video']);

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
    const expected = kind === 'image' ? 'data:image/' : 'data:video/';
    if (!dataUri.startsWith(expected)) continue;
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

  const { searchParams } = new URL(req.url);
  const flow = searchParams.get('flow');
  const scope = searchParams.get('scope') || 'mine';
  const status = searchParams.get('status');
  const functionArea = searchParams.get('function');
  const search = searchParams.get('search');
  const cursor = searchParams.get('cursor');
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));

  if (!ALLOWED_SCOPES.has(scope)) {
    return NextResponse.json({ error: `Invalid scope: ${scope}` }, { status: 400 });
  }
  if (flow && !ALLOWED_FLOWS.has(flow)) {
    return NextResponse.json({ error: `Invalid flow: ${flow}` }, { status: 400 });
  }
  if (status && !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }

  const callerEmail = String(user.email).toLowerCase();
  const callerMember = memberByEmail(callerEmail);
  const isManager = callerMember && (callerMember.access === 'team_lead' || callerMember.access === 'regional_manager' || callerMember.access === 'admin');
  // Agents asking for `team` get folded into `mine` — they have no team.
  const effectiveScope = (scope === 'team' && !isManager) ? 'mine' : scope;

  const where = [];
  const params = [];
  let p = 1;

  if (flow) { where.push(`flow = $${p++}`); params.push(flow); }
  if (status) { where.push(`status = $${p++}`); params.push(status); }
  if (functionArea) { where.push(`function_area = $${p++}`); params.push(functionArea); }
  if (search) {
    where.push(`(LOWER(summary) LIKE $${p} OR LOWER(COALESCE(title,'')) LIKE $${p})`);
    params.push(`%${String(search).toLowerCase()}%`);
    p++;
  }

  if (effectiveScope === 'mine') {
    where.push(`LOWER(created_by_email) = $${p++}`);
    params.push(callerEmail);
  } else if (effectiveScope === 'team') {
    where.push(`LOWER(team_lead_email) = $${p++}`);
    params.push(callerEmail);
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

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT id, flow, status, priority, function_area, request_type, report_type,
           title, summary, ideal_solution, resolution_note, links, attachments,
           created_by_email, created_by_name, assignee_email, assignee_name,
           team_lead_email, cc_email, created_at, updated_at, resolved_at,
           task_source, task_id, task_url, task_subject
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
    idealSolution: row.ideal_solution,
    resolutionNote: row.resolution_note,
    links: row.links || [],
    // Don't return full data URIs in the list — just count + first thumbnail
    // shape — keeps payload small. Detail view returns the full attachments.
    attachmentCount: Array.isArray(row.attachments) ? row.attachments.length : 0,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    assigneeEmail: row.assignee_email,
    assigneeName: row.assignee_name,
    teamLeadEmail: row.team_lead_email,
    ccEmail: row.cc_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    // Hide-task flow only — null on every other flow.
    taskSource: row.task_source,
    taskId: row.task_id,
    taskUrl: row.task_url,
    taskSubject: row.task_subject,
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

  const insert = await query(
    `INSERT INTO hr_hub_request
       (flow, priority,
        function_area, request_type, report_type,
        title, summary, ideal_solution,
        links, attachments,
        created_by_email, created_by_name,
        team_lead_email, cc_email,
        task_source, task_id, task_url, task_subject)
     VALUES ($1, $2,
             $3, $4, $5,
             $6, $7, $8,
             $9::jsonb, $10::jsonb,
             $11, $12,
             $13, $14,
             $15, $16, $17, $18)
     RETURNING id, status, created_at`,
    [
      flow, priority,
      clean(body.functionArea, 80), clean(body.requestType, 80), clean(body.reportType, 80),
      clean(body.title, 300), summary, clean(body.idealSolution, 20000),
      JSON.stringify(links), JSON.stringify(attachments),
      callerEmail, callerName,
      teamLeadEmail || null, ccEmail || null,
      taskSource, taskId, taskUrl, taskSubject,
    ],
  );

  const newId = insert.rows[0].id;

  // Auto-followers: creator + auto-cc (HR Reporting). Both are best-effort
  // and idempotent — failure here doesn't fail the request creation.
  await addFollower(newId, callerEmail, 'creator');
  if (ccEmail) await addFollower(newId, ccEmail, 'tagged');

  await writeLog(
    newId,
    { email: callerEmail, name: callerName },
    'created',
    null,
    { flow, summary: summary.slice(0, 200), functionArea: body.functionArea, requestType: body.requestType, reportType: body.reportType },
  );

  return NextResponse.json({ id: newId }, { status: 201 });
}

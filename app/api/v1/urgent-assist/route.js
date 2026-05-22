// ── /api/v1/urgent-assist ─────────────────────────────────────────────────
// GET  — paginated list of MANUAL urgent assist requests, scoped by
//        ?scope=mine|team|all. Workbench-sourced rows are merged in by the
//        client (FE useUrgentAssistData hook) so the table view shows both
//        without duplicating Deel-side state on our DB.
// POST — create a manual urgent assist. The caller picks subject, type,
//        country, assignee, link_url, status, priority. Audit row written.
//
// Scoping rules — same shape as HR Hub for consistency:
//   • mine → created_by_email = caller OR assignee_email = caller
//   • team → team_lead_email = caller (manager-only; agents collapse to mine)
//   • all  → admin-style; non-admins effectively still see mine + team
//            (DB is small; full read is fine here, but keep the contract
//            honest so client filtering stays predictable).
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { query } from '../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../src/lib/roster-server';
import { memberByEmail, teamLeadEmailFor, writeLog } from '../../../../src/lib/urgent-assist-helpers';
import { MEMBERS_BY_EMAIL, getDirectReports, getAllReports } from '../../../../src/data/members';
import { getCurrentDeptId } from '../../../../src/lib/dept-scope';

const ALLOWED_STATUSES = new Set(['new', 'in_progress', 'on_hold', 'resolved']);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_SCOPES = new Set(['mine', 'team', 'all']);
const DEFAULT_REQUEST_TYPE = 'HRX Urgent Assist Request';

function clean(str, max) {
  if (typeof str !== 'string') return null;
  const t = str.trim();
  if (!t) return null;
  return max && t.length > max ? t.slice(0, max) : t;
}

function cleanLink(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  if (t.length > 2000) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

function rowToJson(row) {
  return {
    id: row.id,
    source: 'manual',
    // 2026-05-22 — kind defaults to 'urgent_assist' for every legacy row.
    // 'case_monitoring' marks Melissa's "watch this task after hours +
    // do X if it fires" flow; the FE branches on this to render the row
    // distinctly and to gate the action_required field.
    kind: row.kind || 'urgent_assist',
    subject: row.subject,
    requestType: row.request_type,
    country: row.country,
    assigneeEmail: row.assignee_email,
    assigneeName: row.assignee_name,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    teamLeadEmail: row.team_lead_email,
    linkUrl: row.link_url,
    description: row.description,
    // Only meaningful for case_monitoring rows; null on regular urgent
    // assists. Surfaced verbatim — no truncation/markdown.
    actionRequired: row.action_required || null,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get('scope') || 'mine';
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const cursor = searchParams.get('cursor');
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));

  if (!ALLOWED_SCOPES.has(scope)) {
    return NextResponse.json({ error: `Invalid scope: ${scope}` }, { status: 400 });
  }
  if (status && !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }

  const callerEmail = String(user.email).toLowerCase();
  const callerMember = memberByEmail(callerEmail);
  const isManager = callerMember && (
    callerMember.access === 'team_lead'
    || callerMember.access === 'regional_manager'
    || callerMember.access === 'admin'
  );
  // Agents asking for `team` collapse to `mine` — they have no team underneath.
  const effectiveScope = (scope === 'team' && !isManager) ? 'mine' : scope;

  const where = [];
  const params = [];
  let p = 1;

  // Phase 11f (2026-05-20): dept-isolate every read. Fails closed.
  const currentDeptId = await getCurrentDeptId(user, req);
  if (currentDeptId) {
    where.push(`org_node_id = $${p++}`);
    params.push(currentDeptId);
  } else {
    where.push(`FALSE`);
  }

  if (status) { where.push(`status = $${p++}`); params.push(status); }
  if (search) {
    where.push(`(LOWER(subject) LIKE $${p} OR LOWER(COALESCE(description,'')) LIKE $${p})`);
    params.push(`%${String(search).toLowerCase()}%`);
    p++;
  }

  if (effectiveScope === 'mine') {
    // Spec (2026-05-03): "My Requests = any request where I'm assigned" —
    // drop the creator-side OR. Manual rows live or die by the
    // assignee_email column; workbench rows do the same on the FE side
    // (see useUrgentAssistData).
    where.push(`LOWER(COALESCE(assignee_email,'')) = $${p}`);
    params.push(callerEmail);
    p++;
  } else if (effectiveScope === 'team') {
    // Manager view (2026-05-04 follow-up): the previous filter relied on
    // the denormalised team_lead_email column matching the caller — but
    // teamLeadEmailFor() returns the FIRST managerial ancestor (TL > RM
    // > admin), so an RM never appears as anyone's team_lead. Melissa's
    // RM view returned 0 rows even when her subtree had assignments.
    //
    // Fix: walk the caller's report subtree on the server using the
    // hydrated roster, then filter by `assignee_email IN (subtree)`.
    // RM = full subtree (getAllReports), TL = direct reports
    // (getDirectReports), admin = full subtree. The caller's own email
    // is always included so a manager who's themselves the assignee on a
    // row still sees it in Team scope (matches the FE counterpart).
    const me = MEMBERS_BY_EMAIL[callerEmail];
    const access = (me?.access || '').toLowerCase();
    const teamSet = new Set([callerEmail]);
    if (access === 'admin' || access === 'regional_manager') {
      for (const e of getAllReports(callerEmail)) teamSet.add(e);
    } else if (access === 'team_lead') {
      for (const r of getDirectReports(callerEmail)) teamSet.add(r.email);
    }
    if (teamSet.size === 1) {
      // No reports → nothing to surface beyond the caller's own assignments.
      where.push(`LOWER(COALESCE(assignee_email,'')) = $${p}`);
      params.push(callerEmail);
      p++;
    } else {
      // Build a parameterised IN list. Postgres handles 1k+ entries fine.
      const placeholders = [];
      for (const e of teamSet) {
        placeholders.push(`$${p++}`);
        params.push(e);
      }
      where.push(`LOWER(COALESCE(assignee_email,'')) IN (${placeholders.join(', ')})`);
    }
  }
  // `all` → no extra predicate.

  if (cursor) {
    const [iso, id] = cursor.split('|');
    if (iso && id) {
      where.push(`(created_at, id) < ($${p++}::timestamptz, $${p++}::uuid)`);
      params.push(iso, id);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT id, subject, request_type, country, assignee_email, assignee_name,
           created_by_email, created_by_name, team_lead_email,
           link_url, description, status, priority,
           kind, action_required,
           created_at, updated_at, resolved_at
      FROM urgent_assist_request
      ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${p}`;
  params.push(limit + 1);

  const { rows } = await query(sql, params);
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(rowToJson);
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

  const subject = clean(body.subject, 300);
  if (!subject) return NextResponse.json({ error: 'subject is required' }, { status: 400 });

  // 2026-05-22 — `kind` selects the flow. Case Monitoring is strict:
  // both `linkUrl` AND `actionRequired` are required so the MOC has the
  // exact pointer + the exact instructions to act on the watch. Regular
  // urgent assists keep linkUrl optional (legacy behaviour).
  const kindRaw = typeof body.kind === 'string' ? body.kind : 'urgent_assist';
  const kind = (kindRaw === 'case_monitoring') ? 'case_monitoring' : 'urgent_assist';

  const linkUrl = cleanLink(body.linkUrl);
  if (body.linkUrl && !linkUrl) {
    return NextResponse.json({ error: 'linkUrl must be a valid http(s) URL (max 2000 chars)' }, { status: 400 });
  }
  if (kind === 'case_monitoring' && !linkUrl) {
    return NextResponse.json({ error: 'linkUrl is required for case monitoring — paste the task link the MOC should watch' }, { status: 400 });
  }
  const actionRequired = clean(body.actionRequired, 20000);
  if (kind === 'case_monitoring' && !actionRequired) {
    return NextResponse.json({ error: 'actionRequired is required for case monitoring — describe what the MOC should do if the case triggers' }, { status: 400 });
  }

  // For case_monitoring rows we default the human-friendly request_type
  // label to "Case Monitoring" so the table's Type column reads
  // correctly even on the FE renderer that uses request_type as a
  // fallback. FE callers can still override this if they want a more
  // specific label.
  const defaultRequestType = kind === 'case_monitoring' ? 'Case Monitoring' : DEFAULT_REQUEST_TYPE;
  const requestType = clean(body.requestType, 120) || defaultRequestType;
  const country = clean(body.country, 8);
  const description = clean(body.description, 20000);
  // Case-monitoring defaults priority to 'critical' — the whole point is
  // after-hours attention. Regular urgent assists keep 'high'.
  const defaultPriority = kind === 'case_monitoring' ? 'critical' : 'high';
  const priority = ALLOWED_PRIORITIES.has(body.priority) ? body.priority : defaultPriority;
  const status = ALLOWED_STATUSES.has(body.status) ? body.status : 'new';

  // Assignee: caller-supplied email + name. Resolve the name from the
  // directory when it's missing so the table doesn't render "(Unassigned)"
  // for a real member just because the FE forgot to pass the name.
  const assigneeEmailRaw = clean(body.assigneeEmail, 255);
  const assigneeEmail = assigneeEmailRaw ? assigneeEmailRaw.toLowerCase() : null;
  let assigneeName = clean(body.assigneeName, 255);
  if (!assigneeName && assigneeEmail) {
    const m = memberByEmail(assigneeEmail);
    if (m?.name) assigneeName = m.name;
  }

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;
  // Denormalised at create-time so the Team scope is a single index scan.
  const teamLeadEmail = teamLeadEmailFor(assigneeEmail || callerEmail);

  // Phase 11f: stamp the submitter's currentDeptId on the new request.
  const submitterDeptId = await getCurrentDeptId(user, req);

  const insert = await query(
    `INSERT INTO urgent_assist_request
       (subject, request_type, country,
        assignee_email, assignee_name,
        created_by_email, created_by_name, team_lead_email,
        link_url, description,
        status, priority,
        org_node_id,
        kind, action_required)
     VALUES ($1, $2, $3,
             $4, $5,
             $6, $7, $8,
             $9, $10,
             $11, $12,
             $13,
             $14, $15)
     RETURNING id, subject, request_type, country, assignee_email, assignee_name,
               created_by_email, created_by_name, team_lead_email,
               link_url, description, status, priority,
               kind, action_required,
               created_at, updated_at, resolved_at`,
    [
      subject, requestType, country,
      assigneeEmail, assigneeName,
      callerEmail, callerName, teamLeadEmail || null,
      linkUrl, description,
      status, priority,
      submitterDeptId,
      kind, actionRequired,
    ],
  );

  const created = insert.rows[0];

  await writeLog(
    created.id,
    { email: callerEmail, name: callerName },
    'created',
    null,
    {
      kind: created.kind,
      subject: created.subject.slice(0, 200),
      requestType: created.request_type,
      country: created.country,
      assigneeEmail: created.assignee_email,
      status: created.status,
      priority: created.priority,
      hasActionRequired: !!created.action_required,
    },
  );

  return NextResponse.json(rowToJson(created), { status: 201 });
}

// ── /api/v1/urgent-assist/[id] ────────────────────────────────────────────
// PATCH  — update fields on a manual urgent assist (status, assignee, link,
//          subject, country, request_type, priority, description). Only the
//          creator, the assignee, the assignee's TL, an RM in the chain, or
//          an admin may edit. Audit row written for every change.
// DELETE — remove a manual urgent assist. Same scope: creator / assignee
//          chain / admin. Cascades to urgent_assist_log via FK.
// GET    — fetch one manual urgent assist by id (any authenticated user).
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import { memberByEmail, teamLeadEmailFor, writeLog, canEdit, getCurrentMocEmail, parseMentions, writeNotifications } from '../../../../../src/lib/urgent-assist-helpers';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';

const ALLOWED_STATUSES = new Set(['new', 'in_progress', 'on_hold', 'resolved']);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

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
    // 2026-05-22 — same shape as the list endpoint. See route.js comment.
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
    actionRequired: row.action_required || null,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

async function loadRow(id, currentDeptId) {
  // Phase 11f: every loadRow caller passes the current dept so cross-dept
  // reads return null (= 404 upstream). Centralises the dept gate.
  if (!currentDeptId) return null;
  const { rows } = await query(
    `SELECT id, subject, request_type, country, assignee_email, assignee_name,
            created_by_email, created_by_name, team_lead_email,
            link_url, description, status, priority,
            kind, action_required,
            created_at, updated_at, resolved_at
       FROM urgent_assist_request
       WHERE id = $1 AND org_node_id = $2`,
    [id, currentDeptId],
  );
  return rows[0] || null;
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const currentDeptId = await getCurrentDeptId(user, req);
  const row = await loadRow(id, currentDeptId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rowToJson(row));
}

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  const { id } = await params;
  // Phase 11f: refuse cross-dept edits.
  const currentDeptId = await getCurrentDeptId(user, req);
  const before = await loadRow(id, currentDeptId);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const callerEmail = String(user.email).toLowerCase();
  const mocEmail = await getCurrentMocEmail(user, req);
  if (!canEdit(user, before, { mocEmail })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  // Build the SET clause incrementally so callers can patch any subset.
  const sets = [];
  const vals = [];
  let p = 1;
  const after = { ...before };

  if (typeof body.subject === 'string') {
    const v = clean(body.subject, 300);
    if (!v) return NextResponse.json({ error: 'subject cannot be empty' }, { status: 400 });
    sets.push(`subject = $${p++}`); vals.push(v); after.subject = v;
  }
  if (typeof body.requestType === 'string') {
    const v = clean(body.requestType, 120);
    sets.push(`request_type = $${p++}`); vals.push(v); after.request_type = v;
  }
  if ('country' in body) {
    const v = body.country == null ? null : clean(String(body.country), 8);
    sets.push(`country = $${p++}`); vals.push(v); after.country = v;
  }
  if ('assigneeEmail' in body) {
    const raw = body.assigneeEmail == null ? null : clean(String(body.assigneeEmail), 255);
    const lc = raw ? raw.toLowerCase() : null;
    sets.push(`assignee_email = $${p++}`); vals.push(lc); after.assignee_email = lc;
    // Re-derive name + team lead off the new assignee.
    let nm = clean(body.assigneeName, 255);
    if (!nm && lc) {
      const m = memberByEmail(lc);
      if (m?.name) nm = m.name;
    }
    sets.push(`assignee_name = $${p++}`); vals.push(nm || null); after.assignee_name = nm || null;
    const tl = teamLeadEmailFor(lc || before.created_by_email);
    sets.push(`team_lead_email = $${p++}`); vals.push(tl || null); after.team_lead_email = tl || null;
  } else if ('assigneeName' in body) {
    const v = body.assigneeName == null ? null : clean(String(body.assigneeName), 255);
    sets.push(`assignee_name = $${p++}`); vals.push(v); after.assignee_name = v;
  }
  if ('linkUrl' in body) {
    const v = body.linkUrl == null ? null : cleanLink(body.linkUrl);
    if (body.linkUrl && !v) return NextResponse.json({ error: 'linkUrl must be a valid http(s) URL' }, { status: 400 });
    sets.push(`link_url = $${p++}`); vals.push(v); after.link_url = v;
  }
  if ('description' in body) {
    const v = body.description == null ? null : clean(String(body.description), 20000);
    sets.push(`description = $${p++}`); vals.push(v); after.description = v;
  }
  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 });
    }
    sets.push(`status = $${p++}`); vals.push(body.status); after.status = body.status;
    // resolved_at follows status: stamps NOW() when transitioning to resolved,
    // clears when moving back to a non-resolved state.
    if (body.status === 'resolved' && before.status !== 'resolved') {
      sets.push(`resolved_at = NOW()`);
      after.resolved_at = new Date().toISOString();
    } else if (body.status !== 'resolved' && before.status === 'resolved') {
      sets.push(`resolved_at = NULL`);
      after.resolved_at = null;
    }
  }
  if (typeof body.priority === 'string') {
    if (!ALLOWED_PRIORITIES.has(body.priority)) {
      return NextResponse.json({ error: `Invalid priority: ${body.priority}` }, { status: 400 });
    }
    sets.push(`priority = $${p++}`); vals.push(body.priority); after.priority = body.priority;
  }

  if (sets.length === 0) {
    return NextResponse.json(rowToJson(before));
  }

  sets.push(`updated_at = NOW()`);
  vals.push(id, currentDeptId);
  // Phase 11f: dept-scope the UPDATE too — race condition guard.
  const sql = `UPDATE urgent_assist_request SET ${sets.join(', ')} WHERE id = $${p} AND org_node_id = $${p + 1} RETURNING *`;
  const { rows } = await query(sql, vals);
  const updated = rows[0];

  // Compact event-typed log entries for the most-meaningful transitions;
  // everything else falls under "field_edit" with a small diff JSON.
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;
  const actor = { email: callerEmail, name: callerName };
  if (typeof body.status === 'string' && body.status !== before.status) {
    await writeLog(id, actor, 'status_change', { status: before.status }, { status: updated.status });
  }
  if ('assigneeEmail' in body && (body.assigneeEmail || null) !== (before.assignee_email || null)) {
    await writeLog(id, actor, 'assignee_change',
      { assigneeEmail: before.assignee_email, assigneeName: before.assignee_name },
      { assigneeEmail: updated.assignee_email, assigneeName: updated.assignee_name },
    );
  }
  if (typeof body.priority === 'string' && body.priority !== before.priority) {
    await writeLog(id, actor, 'priority_change', { priority: before.priority }, { priority: updated.priority });
  }
  // Catch-all field_edit for everything else that changed in this PATCH.
  const ignoreKeys = new Set(['status', 'assigneeEmail', 'priority', 'assigneeName']);
  const editedKeys = Object.keys(body).filter(k => !ignoreKeys.has(k));
  if (editedKeys.length > 0) {
    const beforeDiff = {};
    const afterDiff = {};
    for (const k of editedKeys) {
      // Map JSON keys to DB columns for the diff.
      const dbKey = k === 'requestType' ? 'request_type'
        : k === 'linkUrl' ? 'link_url'
        : k;
      beforeDiff[k] = before[dbKey];
      afterDiff[k] = updated[dbKey];
    }
    await writeLog(id, actor, 'field_edit', beforeDiff, afterDiff);
  }

  // Raquel Sanchez 2026-05-28 — bell-notification fan-out for the two
  // tag-shaped edits MOC cares about: assignee change and new
  // @-mentions in description/action_required. Failures here are
  // non-fatal — the row is already updated and the PATCH returns 200
  // regardless. See app/api/v1/urgent-assist/route.js (POST) for the
  // mirror at create-time.
  const kindLabel = updated.kind === 'case_monitoring' ? 'Case Monitoring' : 'Urgent Assist';
  const subjectSnippet = (updated.subject || '').slice(0, 80);
  // 1. Assignment change — notify the new assignee when it transitions
  //    to a different email (or from null → email). Skip when the new
  //    assignee is the caller (don't ping yourself for self-assigns).
  const beforeAssignee = (before.assignee_email || '').toLowerCase();
  const afterAssignee = (updated.assignee_email || '').toLowerCase();
  if (afterAssignee && afterAssignee !== beforeAssignee && afterAssignee !== callerEmail) {
    try {
      await writeNotifications({
        recipients: [afterAssignee],
        excludeEmail: callerEmail,
        type: 'assignment',
        title: `${kindLabel} assigned: ${subjectSnippet}`,
        body: `${callerName} assigned this ${kindLabel.toLowerCase()} to you.`,
        requestId: id,
        sourceType: 'urgent_assist_assignment',
        // Use the row id + a per-event suffix so a re-assign later
        // de-dupes against itself but not against the original create-
        // time notification (which used just the row id).
        sourceId: `${id}:patch:${Date.now()}`,
        actor,
      });
    } catch (err) {
      console.warn('[urgent-assist] PATCH assignment notification failed:', err.message);
    }
  }
  // 2. New mentions — diff the parsed sets so a no-op edit on
  //    description (or any unrelated field edit on a row whose body
  //    already contained @-tokens) doesn't re-fire the same
  //    notification. Only people newly appearing in the after-set get
  //    pinged. Skip the actor and the current assignee (assignment
  //    notification covers them).
  try {
    const beforeSet = new Set([
      ...parseMentions(before.description),
      ...parseMentions(before.action_required),
    ]);
    const afterMentions = [
      ...parseMentions(updated.description),
      ...parseMentions(updated.action_required),
    ];
    const skip = new Set([callerEmail]);
    if (afterAssignee) skip.add(afterAssignee);
    const newRecipients = Array.from(new Set(afterMentions)).filter(e => !beforeSet.has(e) && !skip.has(e));
    if (newRecipients.length > 0) {
      await writeNotifications({
        recipients: newRecipients,
        excludeEmail: callerEmail,
        type: 'mention',
        title: `${callerName} mentioned you in ${kindLabel.toLowerCase()}`,
        body: subjectSnippet,
        requestId: id,
        sourceType: 'urgent_assist_mention',
        sourceId: `${id}:patch:${Date.now()}`,
        actor,
      });
    }
  } catch (err) {
    console.warn('[urgent-assist] PATCH mention notification failed:', err.message);
  }

  return NextResponse.json(rowToJson(updated));
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  const { id } = await params;
  // Phase 11f: refuse cross-dept deletes.
  const currentDeptId = await getCurrentDeptId(user, req);
  const before = await loadRow(id, currentDeptId);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const callerEmail = String(user.email).toLowerCase();
  const mocEmail = await getCurrentMocEmail(user, req);
  if (!canEdit(user, before, { mocEmail })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Write the audit row BEFORE the delete so the FK CASCADE doesn't take it
  // out — log the snapshot as `before_json`. Then delete; cascade nukes
  // earlier log rows for the same request_id, which is fine: the deletion
  // is the terminal event.
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;
  await writeLog(id, { email: callerEmail, name: callerName }, 'deleted', {
    subject: before.subject,
    status: before.status,
    assigneeEmail: before.assignee_email,
    createdByEmail: before.created_by_email,
  }, null);

  await query(
    'DELETE FROM urgent_assist_request WHERE id = $1 AND org_node_id = $2',
    [id, currentDeptId],
  );
  return NextResponse.json({ ok: true });
}

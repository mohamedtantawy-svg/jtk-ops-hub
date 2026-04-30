// ── /api/v1/feedback/[id] ────────────────────────────────────────────────
// GET    — fetch a single request, with vote totals + the viewer's own vote.
// PATCH  — change status / priority / category / assignee / resolution note.
//          Restricted to admin and regional_manager (mirrors how every other
//          board-level mutation is gated in this codebase).
// DELETE — remove the request entirely. Admin-only.
//
// Both PATCH and DELETE bump updated_at; PATCH also stamps resolved_at the
// first time the request transitions into a terminal state (done / wont_do /
// duplicate) so reporting can answer "how long was this open".
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser, requireRole } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';

const ALLOWED_STATUS = new Set(['new', 'triaged', 'in_progress', 'done', 'wont_do', 'duplicate']);
const ALLOWED_PRIORITY = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_TYPE = new Set(['bug', 'improvement', 'question']);
const TERMINAL_STATUS = new Set(['done', 'wont_do', 'duplicate']);

// Mirror buildAttachments from /feedback/route.js — legacy rows fall back to
// the single `screenshot` column so old submissions render alongside new
// multi-attachment ones.
function buildAttachments(row) {
  const stored = Array.isArray(row.attachments) ? row.attachments : [];
  if (stored.length > 0) return stored;
  if (row.screenshot) {
    return [{ kind: 'image', dataUri: row.screenshot, name: 'screenshot' }];
  }
  return [];
}

function rowToShape(row) {
  return {
    id: row.id,
    title: row.title,
    issue: row.issue,
    proposedResolution: row.proposed_resolution,
    screenshot: row.screenshot,
    attachments: buildAttachments(row),
    status: row.status,
    priority: row.priority,
    category: row.category,
    type: row.type,
    submitterId: row.submitter_id,
    submitterEmail: row.submitter_email,
    submitterName: row.submitter_name,
    assigneeId: row.assignee_id,
    // Drift-proof identifiers — see app/api/v1/feedback/route.js for why
    // we surface email + name alongside the numeric id.
    assigneeEmail: row.assignee_email || null,
    assigneeName:  row.assignee_name  || null,
    resolutionNote: row.resolution_note,
    duplicateOf: row.duplicate_of,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    upvotes: Number(row.upvotes || 0),
    downvotes: Number(row.downvotes || 0),
    score: Number(row.score || 0),
    commentCount: Number(row.comment_count || 0),
    myVote: row.my_vote == null ? 0 : Number(row.my_vote),
  };
}

const SELECT_WITH_AGGS = `
  SELECT r.*,
         a.email                     AS assignee_email,
         a.name                      AS assignee_name,
         COALESCE(v.up, 0)           AS upvotes,
         COALESCE(v.down, 0)         AS downvotes,
         COALESCE(v.up, 0) - COALESCE(v.down, 0) AS score,
         COALESCE(c.cnt, 0)          AS comment_count,
         mv.vote                     AS my_vote
    FROM feedback_requests r
    LEFT JOIN members a ON a.id = r.assignee_id
    LEFT JOIN (
      SELECT request_id,
             SUM(CASE WHEN vote =  1 THEN 1 ELSE 0 END) AS up,
             SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down
        FROM feedback_votes
       GROUP BY request_id
    ) v  ON v.request_id = r.id
    LEFT JOIN (
      SELECT request_id, COUNT(*) AS cnt FROM feedback_comments GROUP BY request_id
    ) c  ON c.request_id = r.id
    LEFT JOIN feedback_votes mv ON mv.request_id = r.id AND mv.user_id = $2
   WHERE r.id = $1
`;

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const { rows } = await query(SELECT_WITH_AGGS, [id, user.id || -1]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: rowToShape(rows[0]) });
  } catch (err) {
    console.error('[feedback/get]', err.message);
    return NextResponse.json({ error: 'Failed to load feedback request' }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  const { authorized, user, status: rs, error } = requireRole(req, 'admin', 'regional_manager');
  if (!authorized) return NextResponse.json({ error }, { status: rs });

  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Build the SET clause from a strict whitelist — no string interpolation
  // of column names from the request body.
  const sets = [];
  const values = [];
  const push = (col, val) => { values.push(val); sets.push(`${col} = $${values.length}`); };

  if (body.status !== undefined) {
    if (!ALLOWED_STATUS.has(body.status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    push('status', body.status);
    if (TERMINAL_STATUS.has(body.status)) push('resolved_at', new Date().toISOString());
    else push('resolved_at', null);
  }
  if (body.priority !== undefined) {
    if (!ALLOWED_PRIORITY.has(body.priority)) return NextResponse.json({ error: 'invalid priority' }, { status: 400 });
    push('priority', body.priority);
  }
  if (body.type !== undefined) {
    if (!ALLOWED_TYPE.has(body.type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });
    push('type', body.type);
  }
  if (body.category !== undefined) push('category', body.category ? String(body.category).slice(0, 50) : null);
  if (body.assigneeId !== undefined) {
    const aid = body.assigneeId == null || body.assigneeId === '' ? null : Number(body.assigneeId);
    if (aid != null && !Number.isFinite(aid)) return NextResponse.json({ error: 'invalid assigneeId' }, { status: 400 });
    push('assignee_id', aid);
  }
  if (body.resolutionNote !== undefined) push('resolution_note', body.resolutionNote ? String(body.resolutionNote).slice(0, 8000) : null);
  if (body.title !== undefined) push('title', String(body.title).slice(0, 200));
  if (body.duplicateOf !== undefined) push('duplicate_of', body.duplicateOf || null);

  if (sets.length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 });
  }
  push('updated_at', new Date().toISOString());

  values.push(id);
  const sql = `UPDATE feedback_requests SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`;

  try {
    const result = await query(sql, values);
    if (result.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { rows } = await query(SELECT_WITH_AGGS, [id, user.id || -1]);
    return NextResponse.json({ item: rowToShape(rows[0]) });
  } catch (err) {
    console.error('[feedback/patch]', err.message);
    return NextResponse.json({ error: 'Failed to update feedback request' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const { authorized, status: rs, error } = requireRole(req, 'admin');
  if (!authorized) return NextResponse.json({ error }, { status: rs });

  const { id } = await params;
  try {
    const result = await query('DELETE FROM feedback_requests WHERE id = $1', [id]);
    if (result.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[feedback/delete]', err.message);
    return NextResponse.json({ error: 'Failed to delete feedback request' }, { status: 500 });
  }
}

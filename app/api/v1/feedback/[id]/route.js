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
import { MEMBERS_BY_EMAIL } from '../../../../../src/data/members';
import { matchesAudience } from '../../../../../src/data/comms';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import {
  isValidEscalationFunctionKey,
  isValidEscalationStatus,
  escalationPriorityToDb,
  normaliseEscalationCountries,
  normaliseEscalationUrl,
} from '../../../../../src/lib/escalation-zero-constants';

// Notify the submitter (and previous commenters) when a feedback request
// transitions status — same fan-out shape the comment route uses, kept
// inline here to avoid a circular import on the helper file. Best-effort:
// a notify failure must never bubble out and 500 the PATCH.
async function notifyFeedbackStatusChange({ id, requestTitle, prev, next, actor }) {
  if (!next || prev === next) return;
  try {
    const submitter = await query(
      `SELECT LOWER(submitter_email) AS email FROM feedback_requests WHERE id = $1`,
      [id],
    );
    const submitterEmail = submitter.rows[0]?.email || null;
    const followers = await query(
      `SELECT DISTINCT LOWER(author_email) AS email
         FROM feedback_comments
        WHERE request_id = $1 AND author_email IS NOT NULL`,
      [id],
    );
    const recipients = Array.from(new Set([
      submitterEmail,
      ...followers.rows.map(r => r.email),
    ].filter(Boolean)));
    const exclude = (actor?.email || '').toLowerCase();
    const filtered = recipients.filter(e => e !== exclude);
    if (filtered.length === 0) return;

    const STATUS_LABEL = {
      new: 'New', triaged: 'Triaged', in_progress: 'In progress',
      paused: 'Paused',
      done: 'Deployed', wont_do: 'Rejected', duplicate: 'Marked duplicate',
    };
    const TERMINAL = new Set(['done', 'wont_do', 'duplicate']);
    const APPROVED = new Set(['done']);
    const DENIED = new Set(['wont_do', 'duplicate']);
    const type = APPROVED.has(next) ? 'approved'
              : DENIED.has(next)   ? 'denied'
              : TERMINAL.has(next) ? 'decision'
              : 'status_change';
    const title = `Status: ${STATUS_LABEL[next] || next}`;
    const actorName = actor?.name || actor?.email || 'Ops Hub';
    const body = `${actorName} changed the status to “${STATUS_LABEL[next] || next}”${prev ? ` (was “${STATUS_LABEL[prev] || prev}”)` : ''}.`.slice(0, 500);
    const placeholders = [];
    const values = [];
    let p = 1;
    for (const r of filtered) {
      placeholders.push(`($${p++}, $${p++}, $${p++}, $${p++}, 'feedback', $${p++}, 'feedback_status_change', $${p++}, $${p++}, $${p++})`);
      values.push(
        r,
        type,
        `${title}: ${requestTitle}`.slice(0, 300),
        body,
        String(id),
        String(id),
        actor?.email || null,
        actor?.name || null,
      );
    }
    await query(
      `INSERT INTO user_notifications
         (recipient_email, type, title, body, link_view, link_id, source_type, source_id, actor_email, actor_name)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT DO NOTHING`,
      values,
    );
  } catch (err) {
    console.warn('[feedback/patch] status-change notify failed:', err.message);
  }
}

// `paused` added 2026-05-11; see /api/v1/feedback/route.js for the rationale.
const ALLOWED_STATUS = new Set(['new', 'triaged', 'in_progress', 'paused', 'done', 'wont_do', 'duplicate']);
const ALLOWED_PRIORITY = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_TYPE = new Set(['bug', 'improvement', 'question']);
const ALLOWED_AUDIENCE = new Set(['global', 'emea', 'apac', 'americas', 'nam', 'latam', 'managers']);
const TERMINAL_STATUS = new Set(['done', 'wont_do', 'duplicate']);

function feedbackAudienceVisible(audience, viewer) {
  const a = String(audience || 'global').toLowerCase();
  if (!a || a === 'global' || a === 'all') return true;
  if (a === 'managers') {
    const role = String(viewer?.role || '').toLowerCase();
    return role === 'admin' || role === 'regional_manager' || role === 'team_lead';
  }
  return matchesAudience(a, viewer?.team);
}

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
    audience: row.audience || 'global',
    // Escalation Zero partition (2026-05-21). See app/api/v1/feedback/route.js
    // for the kind + extras shape contract.
    kind: row.kind || 'ops_hub_feedback',
    extras: row.extras && typeof row.extras === 'object' ? row.extras : {},
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
    const item = rowToShape(rows[0]);

    // Audience gate. Author + admin always see; anyone else needs to
    // match the audience scope. Returns 404 (not 403) when out of scope
    // so we don't leak the existence of audience-scoped rows.
    const lcEmail = String(user.email || '').toLowerCase();
    const role = String(user.role || '').toLowerCase();
    const isAdmin = role === 'admin';
    const isAuthor = (item.submitterEmail || '').toLowerCase() === lcEmail;
    if (!isAdmin && !isAuthor) {
      await ensureRosterHydrated();
      const member = MEMBERS_BY_EMAIL[lcEmail] || null;
      if (!feedbackAudienceVisible(item.audience, { team: member?.team, role })) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }
    return NextResponse.json({ item });
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
  if (body.audience !== undefined) {
    const a = String(body.audience || 'global').toLowerCase();
    if (!ALLOWED_AUDIENCE.has(a)) return NextResponse.json({ error: 'invalid audience' }, { status: 400 });
    push('audience', a);
  }
  if (body.assigneeId !== undefined) {
    const aid = body.assigneeId == null || body.assigneeId === '' ? null : Number(body.assigneeId);
    if (aid != null && !Number.isFinite(aid)) return NextResponse.json({ error: 'invalid assigneeId' }, { status: 400 });
    push('assignee_id', aid);
  }
  if (body.resolutionNote !== undefined) push('resolution_note', body.resolutionNote ? String(body.resolutionNote).slice(0, 8000) : null);
  if (body.title !== undefined) push('title', String(body.title).slice(0, 200));
  if (body.duplicateOf !== undefined) push('duplicate_of', body.duplicateOf || null);

  // ── Escalation Zero extras (2026-05-21) ──────────────────────────────────
  // For kind='escalation_zero' rows, admins can patch the structured extras
  // fields (functionKey, countries, linkedZdUrl, linkedJiraUrl, priorityKey,
  // escalationStatus). We merge into the existing extras JSONB rather than
  // overwriting so partial edits don't drop fields the caller didn't send.
  // Whitelisting + normalisation mirrors POST so updates can't smuggle in
  // invalid data after creation.
  if (body.extras !== undefined && body.extras && typeof body.extras === 'object') {
    const e = body.extras;
    const patch = {};
    if (e.functionKey !== undefined) {
      if (!isValidEscalationFunctionKey(e.functionKey)) {
        return NextResponse.json({ error: 'invalid extras.functionKey' }, { status: 400 });
      }
      patch.functionKey = e.functionKey;
    }
    if (e.countries !== undefined) {
      patch.countries = normaliseEscalationCountries(e.countries);
    }
    if (e.linkedZdUrl !== undefined) {
      patch.linkedZdUrl = normaliseEscalationUrl(e.linkedZdUrl);
    }
    if (e.linkedJiraUrl !== undefined) {
      patch.linkedJiraUrl = normaliseEscalationUrl(e.linkedJiraUrl);
    }
    if (e.priorityKey !== undefined) {
      patch.priorityKey = (e.priorityKey === 'urgent') ? 'urgent' : 'standard';
      // Mirror the canonical priority onto the existing column so the
      // existing priority filter + index stay consistent.
      push('priority', escalationPriorityToDb(patch.priorityKey));
    }
    if (e.escalationStatus !== undefined) {
      if (!isValidEscalationStatus(e.escalationStatus)) {
        return NextResponse.json({ error: 'invalid extras.escalationStatus' }, { status: 400 });
      }
      patch.escalationStatus = e.escalationStatus;
    }
    if (Object.keys(patch).length > 0) {
      // jsonb concat (||) merges keys; null values would clear them but we
      // don't expose that path because the FE never sends nulls for these.
      values.push(JSON.stringify(patch));
      sets.push(`extras = COALESCE(extras, '{}'::jsonb) || $${values.length}::jsonb`);
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 });
  }
  push('updated_at', new Date().toISOString());

  values.push(id);
  const sql = `UPDATE feedback_requests SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`;

  try {
    // Capture the prior status before the UPDATE so the status-change
    // notification can include "(was X)" without an extra round-trip.
    let prevStatus = null;
    let prevTitle = null;
    if (body.status !== undefined) {
      const prior = await query(
        `SELECT status, title FROM feedback_requests WHERE id = $1`,
        [id],
      );
      prevStatus = prior.rows[0]?.status || null;
      prevTitle = prior.rows[0]?.title || null;
    }
    const result = await query(sql, values);
    if (result.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { rows } = await query(SELECT_WITH_AGGS, [id, user.id || -1]);

    if (body.status !== undefined && prevStatus !== body.status) {
      await notifyFeedbackStatusChange({
        id,
        requestTitle: prevTitle || rows[0]?.title || '(feedback request)',
        prev: prevStatus,
        next: body.status,
        actor: { email: (user.email || '').toLowerCase(), name: user.name || null },
      });
    }
    return NextResponse.json({ item: rowToShape(rows[0]) });
  } catch (err) {
    console.error('[feedback/patch]', err.message);
    return NextResponse.json({ error: 'Failed to update feedback request' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  // Mirrors PATCH's gate above (admin + regional_manager). The FE's trash
  // affordance in FeedbackView is gated on `isAdmin`, which resolves to
  // anyone with `can_manage_settings` — that's Admin AND Regional Manager
  // (see accessControl.js: both bundle [...ALL_ADMIN_POWERS]). Until 2026-
  // 05-20 the server gate was `'admin'`-only, so every RM click on the
  // trash icon hit a 403 and surfaced as a silent "Delete failed" toast
  // (Melissa Capicchiano 2026-05-20 "delete button also doesn't work" —
  // she's a regional_manager triaging a duplicate she'd just posted).
  // TL is intentionally excluded — they don't have can_manage_settings,
  // so the FE never renders the button for them in the first place.
  const { authorized, status: rs, error } = requireRole(req, 'admin', 'regional_manager');
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

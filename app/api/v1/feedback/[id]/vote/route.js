// ── /api/v1/feedback/[id]/vote ───────────────────────────────────────────
// POST { vote: 1 | -1 | 0 }
//   • +1 / -1 → upsert into feedback_votes (composite PK enforces "one vote
//                per user per request" at the DB level — no race window).
//   •  0      → delete the user's vote on this request.
//
// Returns the request with refreshed vote totals so the FE can update
// without a separate round-trip.
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { MEMBERS_BY_EMAIL } from '../../../../../../src/data/members';
import { matchesAudience } from '../../../../../../src/data/comms';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { query } from '../../../../../../src/lib/db';

function rowToShape(row) {
  return {
    id: row.id,
    title: row.title,
    issue: row.issue,
    proposedResolution: row.proposed_resolution,
    screenshot: row.screenshot,
    status: row.status,
    priority: row.priority,
    category: row.category,
    type: row.type,
    submitterId: row.submitter_id,
    submitterEmail: row.submitter_email,
    submitterName: row.submitter_name,
    assigneeId: row.assignee_id,
    // Drift-proof identifiers — see app/api/v1/feedback/route.js.
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

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email || !user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const vote = Number(body.vote);
  if (![1, -1, 0].includes(vote)) {
    return NextResponse.json({ error: 'vote must be 1, -1 or 0' }, { status: 400 });
  }

  // Audience gate (Sarah Suge 2026-05-07). Voting requires the same
  // visibility as reading — otherwise an agent with a row id from a
  // stale link could vote on private feedback. Returns 404 to avoid
  // leaking the existence of audience-scoped rows.
  try {
    const { rows: scopeRows } = await query(
      `SELECT audience, submitter_email FROM feedback_requests WHERE id = $1`,
      [id],
    );
    if (scopeRows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const aud = String(scopeRows[0].audience || 'global').toLowerCase();
    if (aud !== 'global' && aud !== 'all') {
      const lcEmail = String(user.email || '').toLowerCase();
      const role = String(user.role || '').toLowerCase();
      const isAdmin = role === 'admin';
      const isAuthor = String(scopeRows[0].submitter_email || '').toLowerCase() === lcEmail;
      if (!isAdmin && !isAuthor) {
        await ensureRosterHydrated();
        const member = MEMBERS_BY_EMAIL[lcEmail] || null;
        const team = member?.team;
        const ok = aud === 'managers'
          ? (role === 'admin' || role === 'regional_manager' || role === 'team_lead')
          : matchesAudience(aud, team);
        if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }
  } catch (err) {
    console.error('[feedback/vote audience-gate]', err.message);
    return NextResponse.json({ error: 'Failed to record vote' }, { status: 500 });
  }

  try {
    if (vote === 0) {
      await query(
        'DELETE FROM feedback_votes WHERE request_id = $1 AND user_id = $2',
        [id, user.id],
      );
    } else {
      await query(
        `INSERT INTO feedback_votes (request_id, user_id, user_email, vote)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (request_id, user_id)
         DO UPDATE SET vote = EXCLUDED.vote, created_at = NOW()`,
        [id, user.id, user.email, vote],
      );
    }
    // Bump the request's updated_at so "recently_updated" sort surfaces it.
    await query('UPDATE feedback_requests SET updated_at = NOW() WHERE id = $1', [id]);

    const { rows } = await query(SELECT_WITH_AGGS, [id, user.id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: rowToShape(rows[0]) });
  } catch (err) {
    console.error('[feedback/vote]', err.message);
    return NextResponse.json({ error: 'Failed to record vote' }, { status: 500 });
  }
}

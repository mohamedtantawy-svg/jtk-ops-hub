// ── /api/v1/feedback ─────────────────────────────────────────────────────
// GET   — list every request, with each viewer's vote and the running totals
//          attached so the FE can render the vote stack without a second
//          round-trip. Supports ?status=, ?category=, ?type=, ?sort= filters.
// POST  — create a new request. Anyone authenticated can submit; requires
//          `title` + `issue` (everything else is optional). Server stamps
//          submitter_id + submitter_email so the row survives display-name
//          changes.
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { query } from '../../../../src/lib/db';

const ALLOWED_SORT = new Set(['top', 'new', 'oldest', 'recently_updated']);

const ALLOWED_STATUS = new Set(['new', 'triaged', 'in_progress', 'done', 'wont_do', 'duplicate']);
const ALLOWED_PRIORITY = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_TYPE = new Set(['bug', 'improvement', 'question']);

// Hard cap on screenshot payload size (base64 data URI). Postgres TEXT is
// effectively 1 GB but writes that big are slow + wasteful — agents
// typically paste ~50–500 KB images, so 3 MB of base64 (~2.2 MB raw) is
// plenty.
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;

function clean(str, max) {
  if (typeof str !== 'string') return null;
  const t = str.trim();
  if (!t) return null;
  return max && t.length > max ? t.slice(0, max) : t;
}

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

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || null;
  const category = url.searchParams.get('category') || null;
  const type = url.searchParams.get('type') || null;
  const sortRaw = url.searchParams.get('sort') || 'top';
  const sort = ALLOWED_SORT.has(sortRaw) ? sortRaw : 'top';

  // ORDER BY clause is built from a whitelist (no string interpolation of
  // user input) so this stays SQL-injection-safe.
  let orderBy;
  switch (sort) {
    case 'new':              orderBy = 'r.created_at DESC'; break;
    case 'oldest':           orderBy = 'r.created_at ASC'; break;
    case 'recently_updated': orderBy = 'r.updated_at DESC'; break;
    case 'top':
    default:                 orderBy = 'score DESC, r.created_at DESC'; break;
  }

  // Status / category / type filters are passed via $N parameters so they're
  // also safe; the WHERE clause skips them when null.
  const filters = [];
  const params = [user.id || -1]; // $1 = current user id (for my_vote)
  if (status && ALLOWED_STATUS.has(status)) { params.push(status); filters.push(`r.status = $${params.length}`); }
  if (category) { params.push(category); filters.push(`r.category = $${params.length}`); }
  if (type && ALLOWED_TYPE.has(type)) { params.push(type); filters.push(`r.type = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const sql = `
    SELECT r.*,
           COALESCE(v.up, 0)           AS upvotes,
           COALESCE(v.down, 0)         AS downvotes,
           COALESCE(v.up, 0) - COALESCE(v.down, 0) AS score,
           COALESCE(c.cnt, 0)          AS comment_count,
           mv.vote                     AS my_vote
      FROM feedback_requests r
      LEFT JOIN (
        SELECT request_id,
               SUM(CASE WHEN vote =  1 THEN 1 ELSE 0 END) AS up,
               SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down
          FROM feedback_votes
         GROUP BY request_id
      ) v  ON v.request_id  = r.id
      LEFT JOIN (
        SELECT request_id, COUNT(*) AS cnt FROM feedback_comments GROUP BY request_id
      ) c  ON c.request_id  = r.id
      LEFT JOIN feedback_votes mv ON mv.request_id = r.id AND mv.user_id = $1
      ${where}
     ORDER BY ${orderBy}
     LIMIT 500
  `;

  try {
    const { rows } = await query(sql, params);
    return NextResponse.json({ items: rows.map(rowToShape) });
  } catch (err) {
    console.error('[feedback/list]', err.message);
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 });
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const title = clean(body.title, 200);
  const issue = clean(body.issue, 8000);
  if (!title || !issue) {
    return NextResponse.json({ error: 'title and issue are required' }, { status: 400 });
  }
  const proposedResolution = clean(body.proposedResolution, 8000);
  const screenshot = typeof body.screenshot === 'string' ? body.screenshot : null;
  if (screenshot && screenshot.length > MAX_SCREENSHOT_BYTES) {
    return NextResponse.json(
      { error: `Screenshot too large (max ${Math.round(MAX_SCREENSHOT_BYTES / 1024 / 1024)} MB)` },
      { status: 413 },
    );
  }
  // Whitelist enums; default to safe values.
  const priority = ALLOWED_PRIORITY.has(body.priority) ? body.priority : 'medium';
  const type = ALLOWED_TYPE.has(body.type) ? body.type : 'bug';
  const category = clean(body.category, 50);
  const submitterId = user.id || null;

  try {
    const { rows } = await query(
      `INSERT INTO feedback_requests
         (title, issue, proposed_resolution, screenshot, priority, type, category,
          submitter_id, submitter_email, submitter_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [title, issue, proposedResolution, screenshot, priority, type, category,
       submitterId, user.email, user.name || null],
    );
    const created = rows[0];
    // Auto-upvote your own submission — the OP always counts as a +1, just
    // like every issue tracker out there. Failure here is non-fatal.
    if (submitterId) {
      try {
        await query(
          `INSERT INTO feedback_votes (request_id, user_id, user_email, vote)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (request_id, user_id) DO NOTHING`,
          [created.id, submitterId, user.email],
        );
      } catch (err) {
        console.warn('[feedback/auto-upvote]', err.message);
      }
    }
    return NextResponse.json({
      item: rowToShape({ ...created, upvotes: submitterId ? 1 : 0, downvotes: 0, score: submitterId ? 1 : 0, comment_count: 0, my_vote: submitterId ? 1 : 0 }),
    }, { status: 201 });
  } catch (err) {
    console.error('[feedback/create]', err.message);
    return NextResponse.json({ error: 'Failed to create feedback request' }, { status: 500 });
  }
}

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
import { MEMBERS_BY_EMAIL } from '../../../../src/data/members';
import { matchesAudience } from '../../../../src/data/comms';
import { ensureRosterHydrated } from '../../../../src/lib/roster-server';

const ALLOWED_SORT = new Set(['top', 'new', 'oldest', 'recently_updated']);

const ALLOWED_STATUS = new Set(['new', 'triaged', 'in_progress', 'done', 'wont_do', 'duplicate']);
const ALLOWED_PRIORITY = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_TYPE = new Set(['bug', 'improvement', 'question']);
// Audience scope (Sarah Suge 2026-05-07 ask): submitters can restrict who
// sees a feedback request. 'global' = everyone; the regional values
// (emea / apac / americas / nam / latam) match member.team via
// matchesAudience(); 'managers' restricts to admin / regional_manager /
// team_lead regardless of team. Author + admin always see their own row,
// so no one accidentally locks themselves out.
const ALLOWED_AUDIENCE = new Set(['global', 'emea', 'apac', 'americas', 'nam', 'latam', 'managers']);

function feedbackAudienceVisible(audience, viewer) {
  const a = String(audience || 'global').toLowerCase();
  if (!a || a === 'global' || a === 'all') return true;
  if (a === 'managers') {
    const role = String(viewer?.role || viewer?.access || '').toLowerCase();
    return role === 'admin' || role === 'regional_manager' || role === 'team_lead';
  }
  return matchesAudience(a, viewer?.team);
}

// Hard cap on screenshot payload size (base64 data URI). Postgres TEXT is
// effectively 1 GB but writes that big are slow + wasteful — agents
// typically paste ~50–500 KB images, so 3 MB of base64 (~2.2 MB raw) is
// plenty.
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
// Per-attachment cap. Images are usually well under this thanks to client-
// side compression; videos (short clips) are larger so we allow more headroom.
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const MAX_TOTAL_PAYLOAD_BYTES = 30 * 1024 * 1024;
const ATTACHMENT_KINDS = new Set(['image', 'video']);

// Normalise + sanity-check the `attachments` payload before INSERT. Drops any
// entry that doesn't carry the bare minimum (kind + dataUri starting with the
// matching MIME prefix). Throws when an entry is too large or the array would
// exceed the per-row cap.
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
    const expectedPrefix = kind === 'image' ? 'data:image/' : 'data:video/';
    if (!dataUri.startsWith(expectedPrefix)) continue;
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

function clean(str, max) {
  if (typeof str !== 'string') return null;
  const t = str.trim();
  if (!t) return null;
  return max && t.length > max ? t.slice(0, max) : t;
}

// Read-side compat: legacy rows have `screenshot` populated and `attachments`
// empty. Surface the screenshot as a synthetic image attachment so the client
// only ever consults the `attachments` array.
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
    submitterId: row.submitter_id,
    submitterEmail: row.submitter_email,
    submitterName: row.submitter_name,
    assigneeId: row.assignee_id,
    // Drift-proof identifiers — the FE prefers email matching over the
    // numeric id (the static MEMBERS array's array-position ids can drift
    // from the DB members.id values). Server JOINs members to surface
    // these so the FE never has to guess.
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
    // Audience filter — runs AFTER the SQL filter so the existing 500-row
    // LIMIT can't be subverted by a viewer who'd otherwise drop below the
    // cap once their team's rows are excluded. Author + admin always see
    // their own / all so no one accidentally locks themselves out.
    await ensureRosterHydrated();
    const lcEmail = String(user.email || '').toLowerCase();
    const member = MEMBERS_BY_EMAIL[lcEmail] || null;
    const role = String(user.role || '').toLowerCase();
    const isAdmin = role === 'admin';
    const items = rows.map(rowToShape).filter(item => {
      if (isAdmin) return true;
      if ((item.submitterEmail || '').toLowerCase() === lcEmail) return true;
      return feedbackAudienceVisible(item.audience, { team: member?.team, role });
    });
    return NextResponse.json({ items });
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
  let attachments;
  try { attachments = sanitiseAttachments(body.attachments); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 400 }); }
  // Whitelist enums; default to safe values.
  const priority = ALLOWED_PRIORITY.has(body.priority) ? body.priority : 'medium';
  const type = ALLOWED_TYPE.has(body.type) ? body.type : 'bug';
  const category = clean(body.category, 50);
  const audience = ALLOWED_AUDIENCE.has(String(body.audience || '').toLowerCase())
    ? String(body.audience).toLowerCase()
    : 'global';
  const submitterId = user.id || null;

  try {
    const { rows } = await query(
      `INSERT INTO feedback_requests
         (title, issue, proposed_resolution, screenshot, attachments, priority, type, category, audience,
          submitter_id, submitter_email, submitter_name)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [title, issue, proposedResolution, screenshot, JSON.stringify(attachments), priority, type, category, audience,
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

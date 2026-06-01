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
import {
  isValidEscalationFunctionKey,
  isValidEscalationStatus,
  isValidResolutionTrack,
  isValidIsoDate,
  escalationPriorityToDb,
  normaliseEscalationCountries,
  normaliseEscalationUrl,
  normaliseEscalationShortText,
  normaliseEscalationLongText,
  normaliseEscalationCount,
  ESCALATION_FIELD_LIMITS,
} from '../../../../src/lib/escalation-zero-constants';

const ALLOWED_SORT = new Set(['top', 'new', 'oldest', 'recently_updated']);

// `paused` was added 2026-05-11 alongside the rename of done/wont_do labels
// to "Deployed" / "Rejected" in the FE. Enum values stay stable so existing
// rows keep their meaning — only the displayed labels change.
const ALLOWED_STATUS = new Set(['new', 'triaged', 'in_progress', 'paused', 'done', 'wont_do', 'duplicate']);
const ALLOWED_PRIORITY = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_TYPE = new Set(['bug', 'improvement', 'question']);

// Escalation Zero (2026-05-21) — second kind on the Feedback board.
// `extras` JSONB carries the kind-specific structured fields (function,
// countries, linked URLs, escalationStatus); the canonical priority is
// mirrored onto the existing feedback_requests.priority column via the
// escalationPriorityToDb() mapping so the existing index still works.
const ALLOWED_KIND = new Set(['ops_hub_feedback', 'escalation_zero']);

// Validate + normalise the escalation extras payload. Returns the cleaned
// shape OR throws an Error with `.status=400` so the caller can surface a
// helpful message. Pure function — no DB hits.
function validateEscalationZeroExtras(rawExtras) {
  const e = (rawExtras && typeof rawExtras === 'object') ? rawExtras : {};
  const functionKey = typeof e.functionKey === 'string' && isValidEscalationFunctionKey(e.functionKey)
    ? e.functionKey
    : null;
  if (!functionKey) {
    throw Object.assign(new Error('HRX Function is required for Escalation Zero'), { status: 400 });
  }
  const countries = normaliseEscalationCountries(e.countries);
  const linkedZdUrl = normaliseEscalationUrl(e.linkedZdUrl);
  const linkedJiraUrl = normaliseEscalationUrl(e.linkedJiraUrl);
  // priorityKey lives in extras so the FE can render the "Standard / Urgent"
  // pill without the priority→dbValue translation drift. The top-level
  // priority column is the database-canonical mirror.
  const priorityKey = (e.priorityKey === 'urgent') ? 'urgent' : 'standard';
  // escalationStatus mirrors the request's status into extras so cross-
  // kind list filters (e.g. "All escalation_zero where status=on_hold")
  // can use either column interchangeably. Init to 'new'.
  const escalationStatus = isValidEscalationStatus(e.escalationStatus) ? e.escalationStatus : 'new';

  // 2026-06-01 — historical xlsx-imported fields. The full surface lives
  // in the detail panel; only a subset shows in the list table. Every
  // field is OPTIONAL — null/empty when not supplied by the caller.
  const reporter         = normaliseEscalationShortText(e.reporter);
  const hrxOwnerName     = normaliseEscalationShortText(e.hrxOwnerName);
  const slackLink        = normaliseEscalationUrl(e.slackLink);
  const etaToResolution  = normaliseEscalationShortText(e.etaToResolution);
  const actionTaken      = normaliseEscalationLongText(e.actionTaken);
  const productName      = normaliseEscalationShortText(e.productName);
  const productOwner     = normaliseEscalationShortText(e.productOwner);
  const hrxPoc           = normaliseEscalationShortText(e.hrxPoc);
  const productComment   = normaliseEscalationLongText(e.productComment);
  const escalationCount6mo = normaliseEscalationCount(e.escalationCount6mo);
  const resolutionTrack    = isValidResolutionTrack(e.resolutionTrack) ? e.resolutionTrack : null;
  const mergedAt           = isValidIsoDate(e.mergedAt) ? e.mergedAt : null;
  // Import provenance — written by the boot-time seeder, retained on
  // round-trip edits so a re-seed can match the existing row. Never
  // user-editable; if the FE accidentally sends it on a new request, we
  // ignore it.
  const importSource     = (typeof e.importSource === 'string' && e.importSource.length <= 40) ? e.importSource : null;
  const importExternalId = (typeof e.importExternalId === 'string' && e.importExternalId.length <= 80) ? e.importExternalId : null;

  const out = {
    functionKey, countries, linkedZdUrl, linkedJiraUrl, priorityKey, escalationStatus,
    reporter, hrxOwnerName, slackLink, etaToResolution, actionTaken,
    productName, productOwner, hrxPoc, productComment,
    escalationCount6mo, resolutionTrack, mergedAt,
    importSource, importExternalId,
  };
  // Strip nulls so the JSONB payload stays compact and FE conditionals
  // can use plain truthy checks.
  for (const k of Object.keys(out)) {
    if (out[k] == null || out[k] === '') delete out[k];
  }
  return out;
}
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
    // Escalation Zero partition (2026-05-21). Default 'ops_hub_feedback'
    // for legacy rows that predate the column.
    kind: row.kind || 'ops_hub_feedback',
    extras: row.extras && typeof row.extras === 'object' ? row.extras : {},
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

// List-shape — every field except the heavy base64 payloads. The
// previous list response shipped every row's full `screenshot` data
// URI AND every entry in `attachments`, which is what made the initial
// Feedback tab load take ~1 min on a busy board (Mohamed 2026-05-13).
// The detail endpoint (`GET /api/v1/feedback/[id]`) still returns the
// full attachments; the FE lazy-fetches it the moment the user opens
// a row. `attachmentCount` is enough for the list-row affordance
// (badge / pip).
function rowToListShape(row) {
  return {
    id: row.id,
    title: row.title,
    issue: row.issue,
    proposedResolution: row.proposed_resolution,
    // Heavy fields intentionally omitted — FE knows how many to draw
    // via `attachmentCount` and triggers a lazy detail-fetch when
    // expanded.
    screenshot: null,
    attachments: [],
    attachmentCount: Number(row.attachment_count || 0),
    status: row.status,
    priority: row.priority,
    category: row.category,
    type: row.type,
    audience: row.audience || 'global',
    // Escalation Zero partition — needed in the list so the FE can
    // render the kind-specific row template (function pill, country
    // flags) without a second detail fetch per row.
    kind: row.kind || 'ops_hub_feedback',
    extras: row.extras && typeof row.extras === 'object' ? row.extras : {},
    submitterId: row.submitter_id,
    submitterEmail: row.submitter_email,
    submitterName: row.submitter_name,
    assigneeId: row.assignee_id,
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
  const kindRaw = url.searchParams.get('kind') || null;
  // Reject unknown kinds so a typo'd query never silently leaks the
  // wrong slice. Empty / missing returns all kinds (the union view).
  const kind = kindRaw && ALLOWED_KIND.has(kindRaw) ? kindRaw : null;
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
  if (kind) { params.push(kind); filters.push(`r.kind = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  // Explicit column projection — the previous `SELECT r.*` pulled the full
  // `screenshot` data URI (up to 3 MB base64) AND every entry of the
  // `attachments` JSON array (up to 12 MB each, 5 per row). With a 500-row
  // limit that meant the list payload could exceed 100 MB, making the
  // Feedback tab's initial load take ~1 min on a healthy connection
  // (Mohamed 2026-05-13 report). We now project the metadata columns only
  // and compute an `attachment_count` so the FE can render an affordance
  // (badge / pip) while the detail endpoint serves the full payload on
  // expand.
  const sql = `
    SELECT r.id, r.title, r.issue, r.proposed_resolution, r.status, r.priority,
           r.category, r.type, r.audience, r.kind, r.extras,
           r.submitter_id, r.submitter_email,
           r.submitter_name, r.assignee_id, r.resolution_note, r.duplicate_of,
           r.resolved_at, r.created_at, r.updated_at,
           a.email                     AS assignee_email,
           a.name                      AS assignee_name,
           COALESCE(v.up, 0)           AS upvotes,
           COALESCE(v.down, 0)         AS downvotes,
           COALESCE(v.up, 0) - COALESCE(v.down, 0) AS score,
           COALESCE(c.cnt, 0)          AS comment_count,
           mv.vote                     AS my_vote,
           (CASE WHEN r.screenshot IS NOT NULL AND r.screenshot <> '' THEN 1 ELSE 0 END)
             + COALESCE(jsonb_array_length(COALESCE(r.attachments, '[]'::jsonb)), 0)
                                       AS attachment_count
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
    const items = rows.map(rowToListShape).filter(item => {
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

  // Kind partition (2026-05-21). Defaults to 'ops_hub_feedback' for the
  // legacy Feedback board entry point. The Escalation Zero composer
  // explicitly sets kind='escalation_zero' + supplies the structured
  // extras payload validated below.
  const kind = ALLOWED_KIND.has(body.kind) ? body.kind : 'ops_hub_feedback';

  // Per-kind length limits — Escalation Zero allows much longer "ideal
  // solution" text (10k chars per scoping doc) than the legacy 8k cap.
  const titleMax = kind === 'escalation_zero' ? ESCALATION_FIELD_LIMITS.summaryMax : 200;
  const issueMax = kind === 'escalation_zero' ? ESCALATION_FIELD_LIMITS.issueMax : 8000;
  const resolutionMax = kind === 'escalation_zero' ? ESCALATION_FIELD_LIMITS.resolutionMax : 8000;

  const title = clean(body.title, titleMax);
  const issue = clean(body.issue, issueMax);
  if (!title || !issue) {
    return NextResponse.json({ error: 'title and issue are required' }, { status: 400 });
  }
  const proposedResolution = clean(body.proposedResolution, resolutionMax);
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

  // Validate + normalise the Escalation Zero extras payload. For
  // ops_hub_feedback the extras are an empty object (any client-supplied
  // extras are dropped — kind-specific fields shouldn't leak across).
  let extras = {};
  let priority = ALLOWED_PRIORITY.has(body.priority) ? body.priority : 'medium';
  if (kind === 'escalation_zero') {
    try { extras = validateEscalationZeroExtras(body.extras); }
    catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 400 }); }
    // Mirror the canonical priority into the existing column so the
    // FE's priority filter + index keep working without a dual lookup.
    priority = escalationPriorityToDb(extras.priorityKey);
  }

  // Whitelist enums; default to safe values.
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
          kind, extras,
          submitter_id, submitter_email, submitter_name)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9,
               $10, $11::jsonb,
               $12, $13, $14)
       RETURNING *`,
      [title, issue, proposedResolution, screenshot, JSON.stringify(attachments), priority, type, category, audience,
       kind, JSON.stringify(extras),
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

// ---------------------------------------------------------------------------
// Announcement flow helpers — shared between the publish endpoint and the
// approval-queue endpoints. Keeps publishing rules in a single place.
// ---------------------------------------------------------------------------
import { query } from './db';

export const VALID_TARGETS = ['all', 'global', 'emea', 'apac', 'americas', 'nam', 'latam', 'leaders', 'group'];
export const VALID_TYPES = ['announce', 'kudos', 'info', 'general', 'alert'];

// Publishing rate limits removed 2026-05-14 (Laura Llopis feedback
// "Urgent override button removal for announcements"). The 2-per-day +
// 4-hour-gap caps used to block legitimate publish flows whenever a
// busy day needed more than two announcements, which is why the urgent
// override existed in the first place. Removing the limit makes the
// override redundant — see the now-deleted checkPublishingRules and
// the publishFromRequest signature below for the cleanup.

/**
 * Insert a row into the request audit log. Non-throwing — audit failures
 * must never block the main action.
 */
export async function recordAudit(requestId, user, action, meta = {}) {
  try {
    await query(
      `INSERT INTO announcement_request_audit
         (request_id, actor_id, actor_email, actor_name, action, meta)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        requestId,
        user?.id || null,
        user?.email || null,
        user?.name || null,
        action,
        JSON.stringify(meta || {}),
      ]
    );
  } catch (err) {
    console.error('[announcementFlow.recordAudit]', err.message);
  }
}

// Poll cap — keeps a single announcement's poll bounded (UI + payload size).
const MAX_POLL_OPTIONS = 10;

/**
 * Sanitize an optional poll attached to an announcement. Returns a normalized
 * { options:[{id,label}], allowMultiple, closesAt } or null when no poll is
 * present. THROWS (→ 400 at the route) when a poll is present but malformed
 * (e.g. < 2 real options) so a half-built poll can't publish. Option ids are
 * assigned server-side by position (o0, o1, …) and are stable for the life of
 * the announcement (polls aren't edited post-publish in v1), so vote rows in
 * announcement_poll_votes always resolve to a real option.
 */
export function sanitizePoll(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object') throw new Error('Invalid poll');
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options = [];
  for (const o of rawOptions) {
    if (options.length >= MAX_POLL_OPTIONS) break;
    const label = (typeof o === 'string' ? o : (o?.label ?? '')).toString().trim();
    if (!label) continue;
    options.push({ id: `o${options.length}`, label: label.slice(0, 200) });
  }
  if (options.length < 2) throw new Error('A poll needs at least 2 non-empty options');
  let closesAt = null;
  if (raw.closesAt) {
    const d = new Date(raw.closesAt);
    if (!Number.isNaN(d.getTime())) closesAt = d.toISOString();
  }
  return { options, allowMultiple: Boolean(raw.allowMultiple), closesAt };
}

/**
 * Normalize a raw payload from a client. Returns a sanitized object or
 * throws an Error with a human-readable message.
 */
export function normalizePayload(raw) {
  const title = (raw?.title || '').toString().trim();
  if (!title) throw new Error('Title required');
  if (title.length > 500) throw new Error('Title too long (max 500 chars)');

  const target = String(raw?.target || 'global').toLowerCase();
  if (!VALID_TARGETS.includes(target)) {
    throw new Error(`Invalid target. Must be one of: ${VALID_TARGETS.join(', ')}`);
  }
  // Tag-group target: the actual audience lives in `target_group_id`. The
  // string column stays as the discriminator 'group'. We accept the UUID
  // here and pass it through; the route layer validates referential
  // integrity (mention_group exists) before INSERT.
  const targetGroupIdRaw = raw?.targetGroupId ? String(raw.targetGroupId).trim() : null;
  const targetGroupId = (targetGroupIdRaw && /^[0-9a-f-]{36}$/i.test(targetGroupIdRaw))
    ? targetGroupIdRaw
    : null;
  if (target === 'group' && !targetGroupId) {
    throw new Error('targetGroupId (UUID) is required when target=group');
  }
  if (target !== 'group' && targetGroupId) {
    // Defensive: a stale group id from a previous draft shouldn't survive
    // a switch back to a region audience. Drop it silently rather than
    // 400ing the publish.
    // (Handled below by only returning targetGroupId when target==='group'.)
  }

  return {
    type: (raw?.type || 'announce').toString(),
    title,
    body: (raw?.body || '').toString(),
    target,
    targetGroupId: target === 'group' ? targetGroupId : null,
    priority: (raw?.priority || 'medium').toString(),
    isPopup: Boolean(raw?.isPopup),
    // Media URL holds either an http(s) link (~bytes) or an inline data URI
    // for an image/video (typically 100KB–10MB after FE compression). The
    // 2000-char slice that lived here truncated every data URI to its
    // first 2KB, leaving every uploaded image as a corrupt header that
    // the browser silently dropped — that was the "image cut out once
    // sent" bug. 15MB is a defensive cap (ingress already limits the
    // request body well below this); the image_url column is TEXT in
    // Postgres so the column itself has no length ceiling.
    imageUrl: raw?.imageUrl ? String(raw.imageUrl).slice(0, 15 * 1024 * 1024) : null,
    link: raw?.link ? String(raw.link).slice(0, 2000) : null,
    soundKey: (raw?.soundKey || 'chime').toString().slice(0, 32),
    // Optional poll. null when absent; throws on malformed (< 2 options).
    poll: sanitizePoll(raw?.poll),
  };
}

/**
 * Promote any 'scheduled' announcements whose scheduled_for time has passed
 * to 'sent'. Idempotent — safe to call from any authenticated endpoint.
 *
 * We don't have a cron worker, so the promotion runs opportunistically on
 * every authenticated API call. Any logged-in user keeps the publishing loop
 * alive. This is why we call it from multiple hot endpoints (list
 * announcements, list announcement requests, /me) rather than only on the
 * announcements page — otherwise scheduled items silently miss their time
 * until someone happens to open the Announcements view.
 */
export async function promoteDueScheduled() {
  try {
    const { rowCount } = await query(
      `UPDATE announcements
         SET status = 'sent',
             sent_at = COALESCE(sent_at, scheduled_for, NOW()),
             updated_at = NOW()
       WHERE status = 'scheduled'
         AND scheduled_for IS NOT NULL
         AND scheduled_for <= NOW()`
    );
    return rowCount || 0;
  } catch (err) {
    // Non-fatal — the next call will try again.
    console.error('[announcementFlow.promoteDueScheduled]', err.message);
    return 0;
  }
}

/**
 * Publish a request — either immediately or scheduled for later.
 * Returns the announcements row created. Caller is responsible for
 * updating the request row afterwards and recording audit.
 *
 * Rate-limit gating and the urgent-override bypass were removed
 * 2026-05-14 (Laura Llopis feedback). Once the steps are completed,
 * the publish proceeds.
 */
export async function publishFromRequest(request, options = {}) {
  const sendAt = options.sendAt instanceof Date ? options.sendAt : null;
  const actor = options.actor || {};
  const immediate = !sendAt || sendAt.getTime() <= Date.now();

  const effective = immediate ? new Date() : sendAt;

  const status = immediate ? 'sent' : 'scheduled';
  const sent_at = immediate ? effective : null;
  const scheduled_for = immediate ? null : effective;

  // Phase 11b (2026-05-20): every announcement is tenanted to a dept. The
  // caller passes orgNodeId explicitly — direct-publish routes pass the
  // actor's currentDeptId; approval routes pass the requester's resolved
  // dept (the rule is "isolation follows the submitter"). Null is permitted
  // only as a temporary safety valve so a publish doesn't 500 if dept
  // resolution fails; the dept-backfill sweep will pick up null rows on
  // the next boot.
  const orgNodeId = options.orgNodeId || null;

  const { rows } = await query(
    `INSERT INTO announcements
       (type, title, body, target, target_group_id, priority, is_popup, image_url, link,
        author_id, sound_key, status, sent_at, scheduled_for, org_node_id, poll)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
     RETURNING *`,
    [
      request.type || 'announce',
      request.title,
      request.body || '',
      request.target || 'global',
      // Only persist a group id when the audience is the 'group' sentinel.
      // Otherwise leave NULL so a leftover id from a prior draft can't
      // accidentally narrow a region-targeted broadcast.
      request.target === 'group' ? (request.target_group_id || null) : null,
      request.priority || 'medium',
      Boolean(request.is_popup),
      request.image_url || null,
      request.link || null,
      // Author = the REQUESTER (per user spec: "show as the requester, not approver")
      request.requested_by_id || actor.id || null,
      request.sound_key || 'chime',
      status,
      sent_at,
      scheduled_for,
      orgNodeId,
      // Optional poll JSONB (null on most announcements). Both the direct
      // publish + approval-publish paths flow through here, so a poll
      // attached on either path is persisted identically.
      request.poll ? JSON.stringify(request.poll) : null,
    ]
  );
  return rows[0];
}

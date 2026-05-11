// ---------------------------------------------------------------------------
// Announcement flow helpers — shared between the publish endpoint and the
// approval-queue endpoints. Keeps publishing rules in a single place.
// ---------------------------------------------------------------------------
import { query } from './db';

export const VALID_TARGETS = ['all', 'global', 'emea', 'apac', 'americas', 'nam', 'latam', 'leaders', 'group'];
export const VALID_TYPES = ['announce', 'kudos', 'info', 'general', 'alert'];

// Publishing rate limits
export const MAX_PUBLISHED_PER_DAY = 2;
export const MIN_GAP_HOURS = 4;

/**
 * Check whether publishing `at` (Date) would violate rate limits.
 * Counts 'sent' and 'scheduled' announcements whose effective publish time
 * falls within the last 24h. Returns { ok, reason } — reason is a
 * human-readable string suitable for surfacing to approvers in the UI.
 */
export async function checkPublishingRules(at) {
  const target = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(target.getTime())) {
    return { ok: false, reason: 'Invalid publish time' };
  }

  // Count published + scheduled announcements whose effective publish time
  // is within a rolling 24h window centred on the candidate time. We count
  // both past (sent) and future (scheduled) to avoid double-booking a day.
  const { rows: dayRows } = await query(
    `SELECT COUNT(*)::int AS n
       FROM announcements
      WHERE status IN ('sent', 'scheduled')
        AND COALESCE(sent_at, scheduled_for) >= $1::timestamptz - interval '24 hours'
        AND COALESCE(sent_at, scheduled_for) <= $1::timestamptz + interval '24 hours'`,
    [target.toISOString()]
  );
  const perDay = dayRows[0]?.n || 0;
  if (perDay >= MAX_PUBLISHED_PER_DAY) {
    return {
      ok: false,
      reason: `Daily limit reached: ${MAX_PUBLISHED_PER_DAY} announcements already within 24 h of that time.`,
    };
  }

  // Nearest neighbour — either past sent_at or future scheduled_for
  const { rows: gapRows } = await query(
    `SELECT ABS(EXTRACT(EPOCH FROM (COALESCE(sent_at, scheduled_for) - $1::timestamptz))) AS secs
       FROM announcements
      WHERE status IN ('sent', 'scheduled')
        AND COALESCE(sent_at, scheduled_for) IS NOT NULL
      ORDER BY secs ASC
      LIMIT 1`,
    [target.toISOString()]
  );
  const nearestSecs = gapRows[0] ? Number(gapRows[0].secs) : Infinity;
  if (nearestSecs < MIN_GAP_HOURS * 3600) {
    const hours = (nearestSecs / 3600).toFixed(1);
    return {
      ok: false,
      reason: `Too close to another announcement (${hours} h away). Minimum gap is ${MIN_GAP_HOURS} h.`,
    };
  }

  return { ok: true };
}

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
 * Rate-limit checks happen here (skippable via urgentOverride).
 */
export async function publishFromRequest(request, options = {}) {
  const sendAt = options.sendAt instanceof Date ? options.sendAt : null;
  const urgentOverride = Boolean(options.urgentOverride);
  const urgentOverrideReason = options.urgentOverrideReason
    ? String(options.urgentOverrideReason)
    : '';
  const actor = options.actor || {};
  const immediate = !sendAt || sendAt.getTime() <= Date.now();

  const effective = immediate ? new Date() : sendAt;

  if (!urgentOverride) {
    const check = await checkPublishingRules(effective);
    if (!check.ok) {
      const err = new Error(check.reason);
      err.code = 'RATE_LIMIT';
      throw err;
    }
  } else {
    // Intentional: rate-limit bypasses are low-volume and must be traceable
    // in server logs even when the direct-publish path doesn't write an
    // announcement_request_audit row. The reason string arrives validated
    // (min length) from the caller.
    console.log(
      `[announcementFlow] urgent-override bypass by ${actor.email || 'unknown'} — reason: ${urgentOverrideReason || '(none)'}`
    );
  }

  const status = immediate ? 'sent' : 'scheduled';
  const sent_at = immediate ? effective : null;
  const scheduled_for = immediate ? null : effective;

  const { rows } = await query(
    `INSERT INTO announcements
       (type, title, body, target, target_group_id, priority, is_popup, image_url, link,
        author_id, sound_key, status, sent_at, scheduled_for)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
    ]
  );
  return rows[0];
}

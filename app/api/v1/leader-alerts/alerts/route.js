// ── /api/v1/leader-alerts/alerts ─────────────────────────────────────────
// GET  — paginated list scoped by ?scope=mine|all (default: all). Filters:
//        status, severity, category, impact (Global|Team|<ISO>), search.
//        Cursor pagination on (created_at, id). Newest-first.
// POST — create a new alert. Auto-follows creator + writes log + (when
//        severity=critical) fans out a notification to every manager.
//
// Auth: any authenticated user can call these routes; the View itself is
// gated to managerial access types in accessControl.js, so non-managers
// shouldn't reach this endpoint via the UI. We still 200 list reads for
// agents because the existing notification bell + URL deep-links are
// allowed to surface a single alert if a manager @-mentions an agent.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import {
  ALLOWED_STATUSES,
  ALLOWED_SEVERITIES,
  ALLOWED_SCOPES,
  clean,
  sanitiseLinks,
  sanitiseAttachments,
  sanitiseImpactTags,
  parseMentions,
  addFollower,
  writeLog,
  writeNotifications,
  listManagerEmails,
  memberByEmail,
  readAllSettings,
} from '../../../../../src/lib/leader-alerts-helpers';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  const { searchParams } = new URL(req.url);
  const scope    = searchParams.get('scope')    || 'all';
  const status   = searchParams.get('status');
  const severity = searchParams.get('severity');
  const category = searchParams.get('category');
  const impact   = searchParams.get('impact');     // single tag filter
  const search   = searchParams.get('search');
  const cursor   = searchParams.get('cursor');
  const limit    = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));

  if (!ALLOWED_SCOPES.has(scope)) {
    return NextResponse.json({ error: `Invalid scope: ${scope}` }, { status: 400 });
  }

  const where = [];
  const params = [];
  let p = 1;

  if (scope === 'mine') {
    where.push(`LOWER(created_by_email) = $${p++}`);
    params.push(user.email.toLowerCase());
  }
  if (status) {
    if (!ALLOWED_STATUSES.has(status)) return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    where.push(`status = $${p++}`); params.push(status);
  }
  if (severity) {
    if (!ALLOWED_SEVERITIES.has(severity)) return NextResponse.json({ error: `Invalid severity: ${severity}` }, { status: 400 });
    where.push(`severity = $${p++}`); params.push(severity);
  }
  if (category) {
    where.push(`category = $${p++}`); params.push(category);
  }
  if (impact) {
    where.push(`$${p++} = ANY(impact_tags)`); params.push(impact);
  }
  if (search) {
    where.push(`(title ILIKE $${p} OR body ILIKE $${p})`);
    params.push(`%${search}%`);
    p++;
  }

  // Cursor pagination on (created_at, id) — opaque base64 of "<iso>:<uuid>".
  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const [iso, id] = decoded.split('|');
      if (iso && id) {
        where.push(`(created_at, id) < ($${p++}::timestamptz, $${p++}::uuid)`);
        params.push(iso, id);
      }
    } catch { /* ignore — bad cursor falls through to first page */ }
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT
      a.id, a.status, a.severity, a.category, a.title, a.body,
      a.impact_tags, a.links, a.attachments,
      a.created_by_email, a.created_by_name,
      a.created_at, a.updated_at, a.resolved_at,
      (SELECT COUNT(*)::int FROM leader_alert_ack ack WHERE ack.alert_id = a.id) AS ack_count,
      (SELECT COUNT(*)::int FROM leader_alert_comment c WHERE c.alert_id = a.id AND c.deleted_at IS NULL) AS comment_count,
      EXISTS(SELECT 1 FROM leader_alert_ack ack WHERE ack.alert_id = a.id AND LOWER(ack.email) = $${p++}) AS i_acked
    FROM leader_alert a
    ${whereClause}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${limit + 1}
  `;
  params.push(user.email.toLowerCase());

  try {
    const { rows } = await query(sql, params);
    let nextCursor = null;
    if (rows.length > limit) {
      const tail = rows[limit - 1];
      nextCursor = Buffer.from(`${tail.created_at.toISOString()}|${tail.id}`, 'utf8').toString('base64');
      rows.length = limit;
    }
    return NextResponse.json({ alerts: rows, nextCursor });
  } catch (err) {
    console.error('[leader-alerts.list]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  let payload;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Validate required fields
  const title = clean(payload.title, 300);
  const body = clean(payload.body, 50_000);
  const category = clean(payload.category, 80);
  const severity = (payload.severity || 'medium').toLowerCase();

  if (!title)    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  if (!body)     return NextResponse.json({ error: 'body is required' }, { status: 400 });
  if (!category) return NextResponse.json({ error: 'category is required' }, { status: 400 });
  if (!ALLOWED_SEVERITIES.has(severity)) {
    return NextResponse.json({ error: `Invalid severity: ${severity}` }, { status: 400 });
  }

  // Validate category against current settings (admin-editable). Soft fail
  // — accept the value if settings haven't loaded yet, since we still want
  // creation to work in degraded conditions.
  try {
    const settings = await readAllSettings();
    const categories = Array.isArray(settings.categories) ? settings.categories : [];
    if (categories.length > 0 && !categories.find(c => c.label === category || c.id === category)) {
      return NextResponse.json({ error: `Unknown category: ${category}` }, { status: 400 });
    }
  } catch { /* degraded mode — let it through */ }

  let impactTags = [];
  try { impactTags = sanitiseImpactTags(payload.impact_tags || payload.impact); }
  catch { return NextResponse.json({ error: 'invalid impact_tags' }, { status: 400 }); }
  if (impactTags.length === 0) {
    return NextResponse.json({ error: 'at least one impact tag is required' }, { status: 400 });
  }

  const links = sanitiseLinks(payload.links);
  let attachments = [];
  try { attachments = sanitiseAttachments(payload.attachments); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 400 }); }

  const member = memberByEmail(user.email);
  const createdByName = member?.name || user.name || user.email;

  // Mentions inline in title or body — captured at create-time and added
  // as followers + notified. Stage 4 also writes the bell entry per
  // notification policy; for Stage 1 we just collect them so the audit
  // log captures the intent.
  const mentions = Array.from(new Set([
    ...parseMentions(title),
    ...parseMentions(body),
  ]));

  try {
    const created = await withTransaction(async (client) => {
      const insert = await client.query(
        `INSERT INTO leader_alert
           (status, severity, category, title, body, impact_tags, links, attachments,
            created_by_email, created_by_name)
         VALUES ('new', $1, $2, $3, $4, $5::text[], $6::jsonb, $7::jsonb, $8, $9)
         RETURNING *`,
        [
          severity, category, title, body,
          impactTags,
          JSON.stringify(links),
          JSON.stringify(attachments),
          user.email.toLowerCase(),
          createdByName,
        ],
      );
      const row = insert.rows[0];

      // Auto-follow the creator
      await client.query(
        `INSERT INTO leader_alert_follower (alert_id, email, source)
         VALUES ($1, $2, 'creator')
         ON CONFLICT (alert_id, email) DO NOTHING`,
        [row.id, user.email.toLowerCase()],
      );

      // Auto-follow each tagged user
      for (const m of mentions) {
        if (m === user.email.toLowerCase()) continue;
        await client.query(
          `INSERT INTO leader_alert_follower (alert_id, email, source)
           VALUES ($1, $2, 'tagged')
           ON CONFLICT (alert_id, email) DO NOTHING`,
          [row.id, m],
        );
      }

      // Audit log
      await client.query(
        `INSERT INTO leader_alert_log (alert_id, actor_email, actor_name, event_type, after_json)
         VALUES ($1, $2, $3, 'created', $4::jsonb)`,
        [
          row.id, user.email.toLowerCase(), createdByName,
          JSON.stringify({ status: row.status, severity, category, title, impact_tags: impactTags, mentions }),
        ],
      );

      return row;
    });

    // Notifications fan-out — Critical → all managers, mentions → tagged
    // users. Outside the transaction so a downstream issue (e.g. one
    // recipient row 23000) doesn't roll back the alert itself.
    try {
      const settings = await readAllSettings();
      const policy = settings.notifications || {};

      // Critical fan-out
      if (severity === 'critical' && policy.newAlertCriticalToAllManagers !== false) {
        const recipients = listManagerEmails();
        await writeNotifications({
          recipients,
          excludeEmail: user.email,
          type: 'critical_alert',
          title: `[Critical] ${title}`,
          body: body.slice(0, 200),
          alertId: created.id,
          sourceType: 'leader_alert_created_critical',
          sourceId: created.id,
          actor: { email: user.email, name: createdByName },
        });
      }

      // Mentions
      if (mentions.length && policy.mentionBell !== false) {
        await writeNotifications({
          recipients: mentions,
          excludeEmail: user.email,
          type: 'mention',
          title: `${createdByName} mentioned you in an alert`,
          body: title,
          alertId: created.id,
          sourceType: 'leader_alert_mention',
          sourceId: created.id,
          actor: { email: user.email, name: createdByName },
        });
      }
    } catch (err) {
      console.warn('[leader-alerts.create] notifications fan-out failed:', err.message);
    }

    return NextResponse.json({ alert: created }, { status: 201 });
  } catch (err) {
    console.error('[leader-alerts.create]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

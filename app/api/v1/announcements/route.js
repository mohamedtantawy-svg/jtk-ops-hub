import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { isApprover } from '../../../../src/data/approvers';
import {
  VALID_TARGETS,
  checkPublishingRules,
  publishFromRequest,
  normalizePayload,
} from '../../../../src/lib/announcementFlow';

// Server-side audience match — mirrors src/data/comms.js matchesAudience()
function matchesAudience(target, memberTeam) {
  if (!target || target === 'all' || target === 'global') return true;
  const t = String(target).toLowerCase();
  const team = String(memberTeam || '').toLowerCase();
  if (!team) return false;
  if (t === team) return true;
  if (team === 'latam + nam' && (t === 'nam' || t === 'latam' || t === 'americas')) return true;
  if (t === 'americas' && (team === 'nam' || team === 'latam' || team === 'latam + nam')) return true;
  return false;
}

// Promote any scheduled announcements whose time has passed to 'sent'.
// Runs before every GET — keeps the audience view fresh without a cron job.
// Idempotent: uses a guarded UPDATE so repeated calls are free.
async function promoteDueScheduled() {
  try {
    await query(
      `UPDATE announcements
         SET status = 'sent',
             sent_at = COALESCE(sent_at, scheduled_for, NOW()),
             updated_at = NOW()
       WHERE status = 'scheduled'
         AND scheduled_for IS NOT NULL
         AND scheduled_for <= NOW()`
    );
  } catch (err) {
    // Non-fatal — readers may briefly see stale data if this fails once
    console.error('[announcements.promoteDueScheduled]', err.message);
  }
}

export async function GET(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Lazy-promote any scheduled rows whose time has arrived.
    await promoteDueScheduled();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const target = searchParams.get('target');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) {
      const statuses = status.split(',');
      whereSql += ` AND status = ANY($${idx++})`;
      params.push(statuses);
    } else {
      // Default: hide scheduled rows from the audience feed. Approvers can
      // opt in via ?status=scheduled on the Approval Queue.
      whereSql += ` AND status <> 'scheduled'`;
    }
    if (target) { whereSql += ` AND target = $${idx++}`; params.push(target); }

    const countSql = 'SELECT COUNT(*) FROM announcements' + whereSql;
    const dataSql = `SELECT id, type, title, body, target, priority, is_popup, image_url, link,
                            status, author_id, pinned, sound_key, sent_at, scheduled_for,
                            created_at, updated_at
                       FROM announcements${whereSql}
                      ORDER BY pinned DESC, COALESCE(sent_at, created_at) DESC
                      LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    // Look up caller's info once (team for audience scope, id for author match)
    let callerTeam = null;
    let callerId = user.id ? Number(user.id) : null;
    if (user.role !== 'admin' || !callerId) {
      const r = await query('SELECT id, team FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1', [user.email]);
      callerTeam = r.rows[0]?.team || null;
      if (!callerId) callerId = r.rows[0]?.id || null;
    }

    const [{ rows }, countResult] = await Promise.all([
      query(dataSql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    // Intentional: admins bypass audience filtering so they can see all
    // announcements across every region for management / moderation purposes.
    // Always include announcements authored by the caller regardless of target.
    const filtered = user.role === 'admin'
      ? rows
      : rows.filter(r =>
          (callerId && r.author_id === callerId) || matchesAudience(r.target, callerTeam)
        );

    // Read canonical acks from announcement_acks table (source of truth)
    const announcementIds = filtered.map(r => r.id);
    let acksMap = {};
    if (announcementIds.length > 0) {
      const acksResult = await query(
        'SELECT announcement_id, ARRAY_AGG(user_id) AS user_ids FROM announcement_acks WHERE announcement_id = ANY($1) GROUP BY announcement_id',
        [announcementIds]
      );
      for (const row of acksResult.rows) {
        acksMap[row.announcement_id] = row.user_ids.map(Number);
      }
    }

    const items = filtered.map(r => ({
      id: r.id, type: r.type, title: r.title, body: r.body,
      target: r.target, priority: r.priority, isPopup: r.is_popup,
      imageUrl: r.image_url, link: r.link, status: r.status,
      authorId: r.author_id, pinned: r.pinned,
      acks: acksMap[r.id] || [],
      soundKey: r.sound_key || 'chime',
      sentAt: r.sent_at,
      scheduledFor: r.scheduled_for,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    const total = parseInt(countResult.rows[0].count, 10);
    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[announcements GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// POST /api/v1/announcements — direct publish (bypasses the approval queue).
// Allowed for: admins, regional_managers, managers, team_leads, and anyone
// in the approver roster. Everyone else must go through
// /api/v1/announcement-requests.
//
// Body may include:
//   scheduledFor   — ISO timestamp; if set, announcement is created with
//                    status='scheduled' and will lazy-promote to 'sent'
//                    when the time arrives.
//   urgentOverride — boolean; skips the 2/day + 4h-gap rate limits. Only
//                    honoured for approvers.
export async function POST(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const allowedRoles = ['admin', 'regional_manager', 'manager', 'team_lead'];
    const approver = isApprover(user.email);
    if (!approver && !allowedRoles.includes(user.role)) {
      return NextResponse.json(
        { error: 'Not allowed to publish directly. Submit via the approval queue.' },
        { status: 403 }
      );
    }

    const raw = await req.json();
    let payload;
    try { payload = normalizePayload(raw); }
    catch (e) { return NextResponse.json({ error: e.message }, { status: 400 }); }

    const scheduledFor = raw.scheduledFor ? new Date(raw.scheduledFor) : null;
    if (scheduledFor && Number.isNaN(scheduledFor.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduledFor' }, { status: 400 });
    }
    const urgentOverride = approver && Boolean(raw.urgentOverride);

    let published;
    try {
      published = await publishFromRequest(
        {
          type: payload.type,
          title: payload.title,
          body: payload.body,
          target: payload.target,
          priority: payload.priority,
          is_popup: payload.isPopup,
          image_url: payload.imageUrl,
          link: payload.link,
          sound_key: payload.soundKey,
          requested_by_id: user.id || null,
        },
        { sendAt: scheduledFor, urgentOverride, actor: user }
      );
    } catch (e) {
      if (e.code === 'RATE_LIMIT') {
        return NextResponse.json({ error: e.message, code: 'RATE_LIMIT' }, { status: 409 });
      }
      throw e;
    }

    return NextResponse.json({
      id: published.id, type: published.type, title: published.title, body: published.body,
      target: published.target, priority: published.priority, isPopup: published.is_popup,
      imageUrl: published.image_url, link: published.link, status: published.status,
      authorId: published.author_id, pinned: published.pinned,
      acks: [],
      soundKey: published.sound_key || 'chime',
      sentAt: published.sent_at,
      scheduledFor: published.scheduled_for,
      createdAt: published.created_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[announcements POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Re-export rule helpers for routes that import from here (none currently).
export { checkPublishingRules, VALID_TARGETS };

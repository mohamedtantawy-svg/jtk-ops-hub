import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { isApprover } from '../../../../src/data/approvers';
import { normalizePayload, recordAudit, promoteDueScheduled } from '../../../../src/lib/announcementFlow';

// GET /api/v1/announcement-requests
//   Approvers:   sees everything (optionally filter via ?status=…)
//   Requester:   sees their own rows only (any status)
//   Others:      empty list (no error — requesters just see an empty list if
//                they've never submitted anything)
export async function GET(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Keep the publishing loop alive: promote any scheduled announcements
    // whose time has passed. useAnnouncementRequests polls this endpoint every
    // 45s, so as long as any authenticated user is logged in, scheduled
    // announcements will reliably auto-publish — no cron worker required.
    await promoteDueScheduled();

    const approver = isApprover(user.email);
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const scope = searchParams.get('scope'); // 'mine' | 'all'

    const wheres = [];
    const params = [];
    let idx = 1;

    if (!approver || scope === 'mine') {
      wheres.push(`LOWER(requested_by_email) = LOWER($${idx++})`);
      params.push(user.email);
    }
    if (statusParam) {
      const statuses = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        wheres.push(`status = ANY($${idx++})`);
        params.push(statuses);
      }
    }
    const whereSql = wheres.length ? ' WHERE ' + wheres.join(' AND ') : '';

    const { rows } = await query(
      `SELECT id, requested_by_id, requested_by_email, requested_by_name,
              status, rejection_reason,
              decided_by_id, decided_by_email, decided_by_name, decided_at,
              scheduled_for, urgent_override,
              type, title, body, target, priority, is_popup, image_url, link, sound_key,
              published_id, published_at,
              created_at, updated_at
         FROM announcement_requests${whereSql}
         ORDER BY
           CASE status WHEN 'pending' THEN 0 WHEN 'needs_info' THEN 1 ELSE 2 END,
           created_at DESC
         LIMIT 500`,
      params
    );

    const items = rows.map((r) => ({
      id: r.id,
      requestedById: r.requested_by_id,
      requestedByEmail: r.requested_by_email,
      requestedByName: r.requested_by_name,
      status: r.status,
      rejectionReason: r.rejection_reason,
      decidedById: r.decided_by_id,
      decidedByEmail: r.decided_by_email,
      decidedByName: r.decided_by_name,
      decidedAt: r.decided_at,
      scheduledFor: r.scheduled_for,
      urgentOverride: r.urgent_override,
      type: r.type,
      title: r.title,
      body: r.body,
      target: r.target,
      priority: r.priority,
      isPopup: r.is_popup,
      imageUrl: r.image_url,
      link: r.link,
      soundKey: r.sound_key,
      publishedId: r.published_id,
      publishedAt: r.published_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return NextResponse.json({
      items,
      canApprove: approver,
    });
  } catch (err) {
    console.error('[announcement-requests GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// POST /api/v1/announcement-requests
//   Any authenticated user may create a request. The initial status is
//   'pending' — approvers will decide from the queue.
export async function POST(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const raw = await req.json();
    let payload;
    try {
      payload = normalizePayload(raw);
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    const scheduledFor = raw.scheduledFor ? new Date(raw.scheduledFor) : null;
    if (scheduledFor && Number.isNaN(scheduledFor.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduledFor' }, { status: 400 });
    }
    // Urgent override can only be toggled on by an approver at decision time,
    // never by the requester. Quietly drop if supplied.
    const urgentOverride = false;

    const { rows } = await query(
      `INSERT INTO announcement_requests
         (requested_by_id, requested_by_email, requested_by_name,
          scheduled_for, urgent_override,
          type, title, body, target, priority, is_popup, image_url, link, sound_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        user.id || null,
        user.email,
        user.name || null,
        scheduledFor,
        urgentOverride,
        payload.type,
        payload.title,
        payload.body,
        payload.target,
        payload.priority,
        payload.isPopup,
        payload.imageUrl,
        payload.link,
        payload.soundKey,
      ]
    );
    const id = rows[0].id;
    await recordAudit(id, user, 'created', {
      title: payload.title,
      target: payload.target,
      scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
    });

    return NextResponse.json({ id, status: 'pending' }, { status: 201 });
  } catch (err) {
    console.error('[announcement-requests POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

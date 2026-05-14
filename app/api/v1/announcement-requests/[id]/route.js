import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { isApprover } from '../../../../../src/data/approvers';
import { isAnnouncementsAdmin } from '../../../../../src/lib/announcements-admin';
import { normalizePayload, recordAudit } from '../../../../../src/lib/announcementFlow';

// GET /api/v1/announcement-requests/:id — detail + comments + audit log
export async function GET(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const { rows } = await query(
      `SELECT * FROM announcement_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const r = rows[0];
    const approver = isApprover(user.email) || (await isAnnouncementsAdmin(user.email));
    const isRequester = String(r.requested_by_email || '').toLowerCase() === user.email.toLowerCase();
    if (!approver && !isRequester) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [commentsResult, auditResult] = await Promise.all([
      query(
        `SELECT id, author_id, author_email, author_name, body, created_at
           FROM announcement_request_comments WHERE request_id = $1 ORDER BY created_at ASC`,
        [id]
      ),
      query(
        `SELECT id, actor_id, actor_email, actor_name, action, meta, created_at
           FROM announcement_request_audit WHERE request_id = $1 ORDER BY created_at ASC`,
        [id]
      ),
    ]);

    return NextResponse.json({
      item: {
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
      },
      comments: commentsResult.rows.map((c) => ({
        id: c.id,
        authorId: c.author_id,
        authorEmail: c.author_email,
        authorName: c.author_name,
        body: c.body,
        createdAt: c.created_at,
      })),
      audit: auditResult.rows.map((a) => ({
        id: a.id,
        actorId: a.actor_id,
        actorEmail: a.actor_email,
        actorName: a.actor_name,
        action: a.action,
        meta: a.meta || {},
        createdAt: a.created_at,
      })),
      canApprove: approver,
      isRequester,
    });
  } catch (err) {
    console.error('[announcement-requests GET /:id]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// PATCH /api/v1/announcement-requests/:id — edit payload.
//   Requester may edit their own pending/needs_info request.
//   Approvers may edit any request in pending/needs_info status, including
//   changing scheduled_for and urgent_override.
//
// 2026-05-14 — `awaiting_post` is now editable too (Laura Llopis
// feedback "Edit announcement on Awaiting slack post status"): the
// requester needs to splice in the Slack thread URL after they post on
// Slack but before triggering the Ops Hub publish. Permissions are the
// same as the pending/needs_info case — requester or approver only.
export async function PATCH(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const { rows: existing } = await query(
      `SELECT * FROM announcement_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const r = existing[0];
    if (!['pending', 'needs_info', 'awaiting_post'].includes(r.status)) {
      return NextResponse.json({ error: `Cannot edit a ${r.status} request` }, { status: 400 });
    }
    const approver = isApprover(user.email) || (await isAnnouncementsAdmin(user.email));
    const isRequester = String(r.requested_by_email || '').toLowerCase() === user.email.toLowerCase();
    if (!approver && !isRequester) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const raw = await req.json();
    let payload;
    try {
      payload = normalizePayload({
        type: raw.type ?? r.type,
        title: raw.title ?? r.title,
        body: raw.body ?? r.body,
        target: raw.target ?? r.target,
        priority: raw.priority ?? r.priority,
        isPopup: raw.isPopup ?? r.is_popup,
        imageUrl: raw.imageUrl ?? r.image_url,
        link: raw.link ?? r.link,
        soundKey: raw.soundKey ?? r.sound_key,
      });
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    let scheduledFor = r.scheduled_for;
    if ('scheduledFor' in raw) {
      if (raw.scheduledFor === null || raw.scheduledFor === '') {
        scheduledFor = null;
      } else {
        const d = new Date(raw.scheduledFor);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: 'Invalid scheduledFor' }, { status: 400 });
        }
        scheduledFor = d;
      }
    }
    // Only approvers may flip the urgent override
    const urgentOverride = approver && typeof raw.urgentOverride === 'boolean'
      ? raw.urgentOverride
      : r.urgent_override;

    // Move status back to pending if a needs_info request is edited by the requester
    const newStatus = r.status === 'needs_info' && isRequester ? 'pending' : r.status;

    await query(
      `UPDATE announcement_requests SET
         type = $1, title = $2, body = $3, target = $4, priority = $5,
         is_popup = $6, image_url = $7, link = $8, sound_key = $9,
         scheduled_for = $10, urgent_override = $11, status = $12,
         updated_at = NOW()
       WHERE id = $13`,
      [
        payload.type, payload.title, payload.body, payload.target, payload.priority,
        payload.isPopup, payload.imageUrl, payload.link, payload.soundKey,
        scheduledFor, urgentOverride, newStatus,
        id,
      ]
    );

    await recordAudit(id, user, 'edited', {
      fields: Object.keys(raw),
      byRequester: isRequester,
      byApprover: approver,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcement-requests PATCH /:id]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

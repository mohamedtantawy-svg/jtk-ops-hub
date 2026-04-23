import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { isApprover } from '../../../../../../src/data/approvers';
import { publishFromRequest, recordAudit } from '../../../../../../src/lib/announcementFlow';

// POST /api/v1/announcement-requests/:id/approve
//   Body: { scheduledFor?: ISOString | null, urgentOverride?: boolean,
//           overrideEdits?: { title?, body?, target?, priority?, isPopup?,
//                             imageUrl?, link?, soundKey?, type? } }
//   Behaviour:
//     * Approver only.
//     * Applies overrideEdits to the request row, then publishes.
//     * Publishing checks rate limits unless urgentOverride === true.
//     * On success: request.status = 'approved', published_id + published_at set.
//     * Records audit events: edited (if overrides), approved, scheduled|published.
export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isApprover(user.email)) {
      return NextResponse.json({ error: 'Only approvers can approve requests' }, { status: 403 });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const { rows: existing } = await query(
      `SELECT * FROM announcement_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (existing.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const r = existing[0];
    if (r.status !== 'pending' && r.status !== 'needs_info') {
      return NextResponse.json({ error: `Cannot approve a ${r.status} request` }, { status: 400 });
    }

    // Apply approver edits, if any
    const edits = body.overrideEdits || {};
    const merged = {
      type: edits.type ?? r.type,
      title: edits.title ?? r.title,
      body: edits.body ?? r.body,
      target: edits.target ?? r.target,
      priority: edits.priority ?? r.priority,
      is_popup: typeof edits.isPopup === 'boolean' ? edits.isPopup : r.is_popup,
      image_url: 'imageUrl' in edits ? edits.imageUrl : r.image_url,
      link: 'link' in edits ? edits.link : r.link,
      sound_key: edits.soundKey ?? r.sound_key,
      requested_by_id: r.requested_by_id,
    };

    // Record edits before the status change so the audit log reflects ordering
    const editedFields = Object.keys(edits);
    if (editedFields.length > 0) {
      await recordAudit(id, user, 'edited', { fields: editedFields, duringApproval: true });
    }

    // Scheduling
    let sendAt = null;
    if (body.scheduledFor) {
      sendAt = new Date(body.scheduledFor);
      if (Number.isNaN(sendAt.getTime())) {
        return NextResponse.json({ error: 'Invalid scheduledFor' }, { status: 400 });
      }
    } else if (r.scheduled_for) {
      sendAt = new Date(r.scheduled_for);
    }
    const urgentOverride = Boolean(body.urgentOverride ?? r.urgent_override);

    let published;
    try {
      published = await publishFromRequest(merged, {
        sendAt,
        urgentOverride,
        actor: user,
      });
    } catch (e) {
      if (e.code === 'RATE_LIMIT') {
        return NextResponse.json({ error: e.message, code: 'RATE_LIMIT' }, { status: 409 });
      }
      throw e;
    }

    const scheduledISO = sendAt && sendAt.getTime() > Date.now() ? sendAt.toISOString() : null;
    await query(
      `UPDATE announcement_requests SET
         status = 'approved',
         decided_by_id = $1, decided_by_email = $2, decided_by_name = $3,
         decided_at = NOW(),
         scheduled_for = $4,
         urgent_override = $5,
         type = $6, title = $7, body = $8, target = $9, priority = $10,
         is_popup = $11, image_url = $12, link = $13, sound_key = $14,
         published_id = $15,
         published_at = CASE WHEN $16::timestamptz IS NULL THEN NOW() ELSE NULL END,
         updated_at = NOW()
       WHERE id = $17`,
      [
        user.id || null, user.email, user.name || null,
        scheduledISO,
        urgentOverride,
        merged.type, merged.title, merged.body, merged.target, merged.priority,
        merged.is_popup, merged.image_url, merged.link, merged.sound_key,
        published.id,
        scheduledISO,
        id,
      ]
    );

    await recordAudit(id, user, 'approved', {
      urgentOverride,
      scheduledFor: scheduledISO,
    });
    await recordAudit(id, user, scheduledISO ? 'scheduled' : 'published', {
      announcementId: published.id,
      scheduledFor: scheduledISO,
    });

    return NextResponse.json({
      ok: true,
      announcementId: published.id,
      scheduled: Boolean(scheduledISO),
      scheduledFor: scheduledISO,
    });
  } catch (err) {
    console.error('[announcement-requests/approve]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

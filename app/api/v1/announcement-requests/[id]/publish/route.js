// POST /api/v1/announcement-requests/:id/publish
//
// Final stage of the two-stage approval flow (Laura's 2026-05-12 ask).
// When the approver picks the default approve path the request
// transitions into status='awaiting_post'; the requester is expected to
// share the announcement on Slack first and then come back to hit this
// endpoint to release it on Ops Hub.
//
// Who can call:
//   • the original requester (their announcement; they confirm the
//     Slack post is out), OR
//   • any approver (override path — useful if the requester is OOO
//     and the announcement still needs to go out).
//
// Body: ignored. The publish reuses the fields stored on the request
// row at approval time (after any approver overrideEdits). If the
// approver wants to change the payload after approval, they must
// withdraw + reissue — this endpoint is intentionally a thin trigger.
//
// On success: announcement row created via the shared publishFromRequest
// helper, request status flips awaiting_post -> approved,
// published_id + published_at set, audit log entry written.
import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { canApproveAnnouncementRequests } from '../../../../../../src/lib/announcements-admin';
import { publishFromRequest, recordAudit } from '../../../../../../src/lib/announcementFlow';
import { getTopLevelDeptForMember } from '../../../../../../src/lib/dept-scope';

export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { rows: existing } = await query(
      `SELECT * FROM announcement_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (existing.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const r = existing[0];
    if (r.status !== 'awaiting_post') {
      return NextResponse.json({
        error: `Cannot publish a ${r.status} request — only awaiting_post is publishable through this endpoint`,
      }, { status: 400 });
    }

    const callerEmail = String(user.email).toLowerCase();
    const isRequester = String(r.requested_by_email || '').toLowerCase() === callerEmail;
    const isApprover = await canApproveAnnouncementRequests(user);
    if (!isRequester && !isApprover) {
      return NextResponse.json({
        error: 'Only the original requester or an approver can publish this announcement',
      }, { status: 403 });
    }

    // Reuse the merged fields stored at approval time. The approver may
    // have edited them inline; those edits are persisted on the
    // request row so the final publish reflects the approved version.
    const merged = {
      type: r.type,
      title: r.title,
      body: r.body,
      target: r.target,
      target_group_id: r.target_group_id || null,
      priority: r.priority,
      is_popup: r.is_popup,
      image_url: r.image_url,
      link: r.link,
      sound_key: r.sound_key,
      requested_by_id: r.requested_by_id,
    };

    const sendAt = r.scheduled_for ? new Date(r.scheduled_for) : null;
    const urgentOverride = Boolean(r.urgent_override);

    // Fetch the urgent-override reason from the approve audit row so the
    // [announcementFlow] urgent-override bypass log records a real reason
    // rather than `(none)`. The reason was captured + validated (≥5 chars)
    // in the approve route; we read it back here for the two-stage publish.
    // Cheap single-row query — only fires when urgentOverride is true.
    let urgentOverrideReason;
    if (urgentOverride) {
      try {
        const { rows: auditRows } = await query(
          `SELECT meta FROM announcement_request_audit
             WHERE request_id = $1 AND action = 'approved'
             ORDER BY created_at DESC
             LIMIT 1`,
          [id],
        );
        const reason = auditRows[0]?.meta?.urgentOverrideReason;
        if (typeof reason === 'string' && reason.trim().length > 0) {
          urgentOverrideReason = reason.trim();
        }
      } catch (auditErr) {
        // Audit read is best-effort — fall back to `(none)` if it fails.
        console.warn('[publish] audit-read failed:', auditErr.message);
      }
    }

    // Phase 11b (2026-05-20): published announcement lands in the
    // REQUESTER's dept (isolation follows the submitter). Approver's
    // currentDeptId is irrelevant for the destination.
    const requesterDept = await getTopLevelDeptForMember(r.requested_by_email);

    let published;
    try {
      published = await publishFromRequest(merged, {
        sendAt,
        urgentOverride,
        urgentOverrideReason,
        actor: user,
        orgNodeId: requesterDept?.deptId || null,
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
         published_id = $1,
         published_at = CASE WHEN $2::timestamptz IS NULL THEN NOW() ELSE NULL END,
         updated_at = NOW()
       WHERE id = $3`,
      [published.id, scheduledISO, id],
    );

    await recordAudit(id, user, scheduledISO ? 'scheduled' : 'published', {
      announcementId: published.id,
      scheduledFor: scheduledISO,
      stage: 'awaiting_post_published',
      triggeredBy: isRequester ? 'requester' : 'approver',
    });

    return NextResponse.json({
      ok: true,
      announcementId: published.id,
      scheduled: Boolean(scheduledISO),
      scheduledFor: scheduledISO,
    });
  } catch (err) {
    console.error('[announcement-requests/publish]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

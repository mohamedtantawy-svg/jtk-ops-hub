import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { isApprover } from '../../../../../../src/data/approvers';
import { canApproveAnnouncementRequests } from '../../../../../../src/lib/announcements-admin';
import { publishFromRequest, recordAudit } from '../../../../../../src/lib/announcementFlow';
import { getTopLevelDeptForMember } from '../../../../../../src/lib/dept-scope';

// POST /api/v1/announcement-requests/:id/approve
//   Body: { scheduledFor?: ISOString | null,
//           overrideEdits?: { title?, body?, target?, priority?, isPopup?,
//                             imageUrl?, link?, soundKey?, type? },
//           publishImmediately?: boolean }
//   Behaviour:
//     * Approver only.
//     * Applies overrideEdits to the request row.
//     * Two-stage flow (default, publishImmediately !== true): approves
//       the request into status='awaiting_post'. No announcement row is
//       created yet — the requester (or the approver, as a follow-up)
//       drives the final publish through POST /publish below AFTER
//       posting on Slack. Matches Laura's 2026-05-12 ask that every
//       announcement go to Slack before the Ops Hub popup.
//     * Override (publishImmediately === true): bypasses the Slack-first
//       stage and publishes inline. Same semantics as the legacy
//       one-shot approve. Useful for urgent fixes / internal notices
//       that don't need a Slack mirror.
//     * On success:
//         two-stage:    status='awaiting_post', awaiting_post_at=NOW().
//         immediate:    status='approved', published_id + published_at set.
//     * Records audit events: edited (if overrides), approved, then
//       awaiting_post | scheduled | published.
//
// 2026-05-14 — Publishing rate limits + the urgent-override bypass were
// removed (Laura Llopis feedback). The `urgent_override` request column
// is kept but always written as FALSE so downstream callers / audit
// queries that still read it see a stable value.
export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await canApproveAnnouncementRequests(user))) {
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
      // Allow approver to edit the tag-group target alongside other fields;
      // fall through to the request's stored group id when not in `edits`.
      target_group_id: 'targetGroupId' in edits ? edits.targetGroupId : r.target_group_id,
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
      // Surface the edit to the requester via a visible comment — the audit
      // log is buried in a collapsed tab, and a silent approval rewrite is
      // exactly the kind of change the requester ought to know about before
      // the announcement reaches the audience. Best-effort: a comment insert
      // failure must never block approval itself.
      try {
        const human = (f) => ({
          title: 'title', body: 'body', target: 'audience', priority: 'priority',
          isPopup: 'popup mode', imageUrl: 'image', link: 'link',
          soundKey: 'sound', type: 'type',
        }[f] || f);
        const summary = editedFields.map(human).join(', ');
        await query(
          `INSERT INTO announcement_request_comments
             (request_id, author_id, author_email, author_name, body)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            id,
            user.id || null,
            user.email,
            user.name || null,
            `Approver edited before publishing: ${summary}. Open the request to see the final version sent to the audience.`,
          ]
        );
      } catch (commentErr) {
        console.warn('[approve] edit-notice comment failed:', commentErr.message);
      }
    }

    // Scheduling — the approver's picker is authoritative. We distinguish
    // three cases:
    //   1. body.scheduledFor is a non-empty string  → use that time
    //   2. body.scheduledFor is explicit null/empty → publish immediately,
    //      OVERRIDING whatever time the requester asked for (otherwise the
    //      approver could never override a scheduled-ahead request).
    //   3. body does not include scheduledFor at all → keep requester's value.
    let sendAt = null;
    if ('scheduledFor' in body) {
      const raw = body.scheduledFor;
      if (raw !== null && raw !== undefined && raw !== '') {
        sendAt = new Date(raw);
        if (Number.isNaN(sendAt.getTime())) {
          return NextResponse.json({ error: 'Invalid scheduledFor' }, { status: 400 });
        }
      }
      // explicit null/empty → sendAt stays null → publishFromRequest publishes now
    } else if (r.scheduled_for) {
      sendAt = new Date(r.scheduled_for);
    }
    // urgent_override removed 2026-05-14 — column is still in the schema
    // but no longer driven by the request body. We always write FALSE so
    // any audit query keyed on this column sees consistent data going
    // forward.
    const publishImmediately = body.publishImmediately === true;
    const scheduledISO = sendAt && sendAt.getTime() > Date.now() ? sendAt.toISOString() : null;

    // Two-stage approval (default). Stash the merged fields + intended
    // send time on the request row, flip status to awaiting_post, and
    // stop here — no announcement row exists yet. The requester (or
    // the approver) finalises publishing through POST /publish once
    // the Slack message is out.
    if (!publishImmediately) {
      await query(
        `UPDATE announcement_requests SET
           status = 'awaiting_post',
           decided_by_id = $1, decided_by_email = $2, decided_by_name = $3,
           decided_at = NOW(),
           awaiting_post_at = NOW(),
           scheduled_for = $4,
           urgent_override = FALSE,
           type = $5, title = $6, body = $7, target = $8, target_group_id = $9,
           priority = $10,
           is_popup = $11, image_url = $12, link = $13, sound_key = $14,
           updated_at = NOW()
         WHERE id = $15`,
        [
          user.id || null, user.email, user.name || null,
          scheduledISO,
          merged.type, merged.title, merged.body, merged.target,
          merged.target === 'group' ? (merged.target_group_id || null) : null,
          merged.priority,
          merged.is_popup, merged.image_url, merged.link, merged.sound_key,
          id,
        ],
      );
      await recordAudit(id, user, 'approved', {
        scheduledFor: scheduledISO,
        awaitingPost: true,
      });
      await recordAudit(id, user, 'awaiting_post', {
        scheduledFor: scheduledISO,
      });
      return NextResponse.json({
        ok: true,
        awaitingPost: true,
        scheduled: Boolean(scheduledISO),
        scheduledFor: scheduledISO,
      });
    }

    // Override path — publishImmediately=true. Behaves like the legacy
    // one-shot approve: create the announcement row inline and mark the
    // request approved.
    //
    // Phase 11b (2026-05-20): the published announcement lands in the
    // REQUESTER's dept, not the approver's — isolation follows the
    // submitter. Approver's currentDeptId is irrelevant here; we resolve
    // the requester's top-level dept from the request row.
    const requesterDept = await getTopLevelDeptForMember(r.requested_by_email);
    const published = await publishFromRequest(merged, {
      sendAt,
      actor: user,
      orgNodeId: requesterDept?.deptId || null,
    });

    await query(
      `UPDATE announcement_requests SET
         status = 'approved',
         decided_by_id = $1, decided_by_email = $2, decided_by_name = $3,
         decided_at = NOW(),
         scheduled_for = $4,
         urgent_override = FALSE,
         type = $5, title = $6, body = $7, target = $8, target_group_id = $9,
         priority = $10,
         is_popup = $11, image_url = $12, link = $13, sound_key = $14,
         published_id = $15,
         published_at = CASE WHEN $16::timestamptz IS NULL THEN NOW() ELSE NULL END,
         updated_at = NOW()
       WHERE id = $17`,
      [
        user.id || null, user.email, user.name || null,
        scheduledISO,
        merged.type, merged.title, merged.body, merged.target,
        merged.target === 'group' ? (merged.target_group_id || null) : null,
        merged.priority,
        merged.is_popup, merged.image_url, merged.link, merged.sound_key,
        published.id,
        scheduledISO,
        id,
      ]
    );

    await recordAudit(id, user, 'approved', {
      scheduledFor: scheduledISO,
      publishImmediately: true,
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

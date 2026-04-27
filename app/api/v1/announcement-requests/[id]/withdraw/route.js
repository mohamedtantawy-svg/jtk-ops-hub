import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { canApproveAnnouncementRequests } from '../../../../../../src/lib/announcements-admin';
import { recordAudit } from '../../../../../../src/lib/announcementFlow';

// POST /api/v1/announcement-requests/:id/withdraw
//   Requester (or an approver) can withdraw a pending/needs_info request.
//   Published requests cannot be withdrawn — the announcement itself should
//   be archived via the existing announcements API.
export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const { rows: existing } = await query(
      `SELECT status, requested_by_email FROM announcement_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (existing.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const r = existing[0];
    const isRequester = String(r.requested_by_email || '').toLowerCase() === user.email.toLowerCase();
    if (!isRequester && !(await canApproveAnnouncementRequests(user))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!['pending', 'needs_info'].includes(r.status)) {
      return NextResponse.json({ error: `Cannot withdraw a ${r.status} request` }, { status: 400 });
    }

    await query(
      `UPDATE announcement_requests SET status = 'withdrawn', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await recordAudit(id, user, 'withdrawn', { byRequester: isRequester });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcement-requests/withdraw]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

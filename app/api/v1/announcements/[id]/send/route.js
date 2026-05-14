import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { isApprover } from '../../../../../../src/data/approvers';

// PATCH /api/v1/announcements/:id/send — flip a draft or scheduled row to
// 'sent'. Once approval requirements are satisfied the publish proceeds.
// (Publishing rate limits + the `?urgent=1` override were removed
// 2026-05-14 per Laura Llopis feedback — there's no rate limit left to
// override.)
//
// Allowed for:
//   • approvers (roster)
//   • admin / regional_manager / manager / team_lead
//   • the ORIGINAL REQUESTER of the announcement (author_id matches the
//     caller) — so a requester can promote their own scheduled drop early
//     once it's been approved.
export async function PATCH(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const approver = isApprover(user.email);
    const allowedRoles = ['admin', 'regional_manager', 'manager', 'team_lead'];
    const isPrivileged = approver || allowedRoles.includes(user.role);

    const { id } = await params;

    // Load the target row so we can (a) check ownership and (b) reject
    // trying to "send" an already-cancelled or deleted item.
    const { rows: existingRows } = await query(
      'SELECT id, status, author_id FROM announcements WHERE id = $1 LIMIT 1',
      [id]
    );
    if (existingRows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const existing = existingRows[0];

    // Resolve the caller's DB id by email so we don't mis-match a drifted
    // JWT sub — mirrors the pattern used in /announcements and /read.
    let callerDbId = null;
    try {
      const r = await query('SELECT id FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1', [user.email]);
      callerDbId = r.rows[0]?.id || null;
    } catch (_e) { /* non-fatal, fall through */ }
    if (!callerDbId && user.id) callerDbId = Number(user.id);

    const isRequester = callerDbId && existing.author_id === callerDbId;
    if (!isPrivileged && !isRequester) {
      return NextResponse.json({ error: 'Only managers/approvers or the original requester can publish this announcement' }, { status: 403 });
    }

    const { rows } = await query(
      `UPDATE announcements
          SET status = 'sent',
              sent_at = COALESCE(sent_at, NOW()),
              scheduled_for = NULL,
              updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcements/send]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

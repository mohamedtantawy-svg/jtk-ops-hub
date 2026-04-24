import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { isApprover } from '../../../../../../../src/data/approvers';

// DELETE /api/v1/announcements/:id/comments/:commentId
// Authorised callers:
//   • the comment author (by email — tolerant of author_id=0 users)
//   • admins, regional managers, managers, team leads (role-based)
//   • anyone in the approver roster
// Everyone else gets 403. Previously this endpoint only checked for an auth
// token, which meant any logged-in user could delete any comment.
export async function DELETE(req, { params }) {
  try {
    const user = getAuthUser(req);
    const email = (user.email || '').trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, commentId } = await params;

    const { rows } = await query(
      `SELECT c.author_id, LOWER(m.email) AS author_email
         FROM announcement_comments c
         LEFT JOIN members m ON m.id = c.author_id
        WHERE c.id = $1 AND c.announcement_id = $2
        LIMIT 1`,
      [commentId, id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const role = String(user.role || '').toLowerCase();
    const isPrivileged =
      isApprover(email) ||
      ['admin', 'regional_manager', 'manager', 'team_lead'].includes(role);

    // The author_id FK can be 0 or NULL for override-only users (JWT sub=0)
    // so we also fall back to the caller-provided email claim from the JWT.
    // There's no author_email column yet; comparing via the join to members
    // is the safest we can do without a schema change.
    const isAuthor =
      rows[0].author_email && rows[0].author_email === email;

    if (!isPrivileged && !isAuthor) {
      return NextResponse.json(
        { error: 'Only the comment author or a manager can delete this comment' },
        { status: 403 }
      );
    }

    await query('DELETE FROM announcement_comments WHERE id = $1', [commentId]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[comments DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

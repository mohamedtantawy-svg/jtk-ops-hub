import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';

export async function DELETE(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, targetId } = await params;
    // Remove BOTH directions. POST writes both sides (see ../route.js) and
    // the UI treats the link as symmetric, so a single-sided delete used to
    // leave a stale half-link that would resurrect on the next refresh of
    // the other announcement.
    await query(
      `DELETE FROM announcement_links
        WHERE (source_id = $1 AND target_id = $2)
           OR (source_id = $2 AND target_id = $1)`,
      [id, targetId]
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[links DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

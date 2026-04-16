import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';

export async function DELETE(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, memberId } = await params;
    await query('DELETE FROM project_members WHERE project_id = $1 AND member_id = $2', [id, memberId]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[members DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

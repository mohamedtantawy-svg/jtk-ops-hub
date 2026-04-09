import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';

export async function DELETE(req, { params }) {
  try {
    const { id, targetId } = await params;
    await query('DELETE FROM announcement_links WHERE source_id = $1 AND target_id = $2', [id, targetId]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[links DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

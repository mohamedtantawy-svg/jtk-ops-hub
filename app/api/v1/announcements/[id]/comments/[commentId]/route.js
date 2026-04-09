import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';

export async function DELETE(req, { params }) {
  try {
    const { commentId } = await params;
    await query('DELETE FROM announcement_comments WHERE id = $1', [commentId]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[comments DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

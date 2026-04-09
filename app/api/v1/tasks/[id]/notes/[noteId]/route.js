import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';

export async function DELETE(req, { params }) {
  try {
    const { noteId } = await params;
    await query('DELETE FROM task_notes WHERE id = $1', [noteId]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[notes DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

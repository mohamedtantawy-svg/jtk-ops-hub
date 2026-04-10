import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';

export async function DELETE(req, { params }) {
  try {
    const { id, taskId } = await params;
    await query('DELETE FROM project_tasks WHERE project_id = $1 AND task_id = $2', [id, taskId]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[tasks DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

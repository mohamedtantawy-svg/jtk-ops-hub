import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const { response } = await req.json();
    if (!response) return NextResponse.json({ error: 'Response required' }, { status: 400 });

    const { rows } = await query(
      `UPDATE escalations SET manager_response = $1, manager_response_status = 'responded',
       manager_responded_at = NOW(), updated_at = NOW() WHERE id = $2 RETURNING *`,
      [response, id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[escalations/respond]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

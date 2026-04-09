import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { rows } = await query('SELECT * FROM tasks WHERE id = $1 OR external_id = $1', [id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const r = rows[0];
    return NextResponse.json({
      id: r.id, externalId: r.external_id, source: r.source, subject: r.subject,
      description: r.description, status: r.status, priority: r.priority,
      assigneeId: r.assignee_id, countryCode: r.country_code, tags: r.tags,
      externalUrl: r.external_url, reporterId: r.reporter_id,
      snoozedUntil: r.snoozed_until, sourceCreatedAt: r.source_created_at,
      createdAt: r.created_at, updatedAt: r.updated_at,
    });
  } catch (err) {
    console.error('[tasks/id GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    await query('DELETE FROM tasks WHERE id = $1 OR external_id = $1', [id]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[tasks/id DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

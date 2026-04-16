import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const whereClause = isUUID ? 'WHERE id = $1' : 'WHERE external_id = $1';
    const { rows } = await query(`SELECT * FROM tasks ${whereClause}`, [id]);
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
  const delUser = getAuthUser(req);
  if (!delUser.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Only admins can delete tasks
  if (delUser.role !== 'admin') return NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 });
  try {
    const { id } = await params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const whereClause = isUUID ? 'WHERE id = $1' : 'WHERE external_id = $1';
    await query(`DELETE FROM tasks ${whereClause}`, [id]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[tasks/id DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

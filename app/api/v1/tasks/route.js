import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const source = searchParams.get('source');
    const country = searchParams.get('country');
    const search = searchParams.get('search');
    const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 500);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const offset = (page - 1) * limit;

    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }
    if (source) { sql += ` AND source = $${idx++}`; params.push(source); }
    if (country) { sql += ` AND country_code = $${idx++}`; params.push(country); }
    if (search) { sql += ` AND (subject ILIKE $${idx} OR description ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const { rows } = await query(sql, params);

    // Map DB columns to API response shape
    const items = rows.map(r => ({
      id: r.id,
      externalId: r.external_id,
      source: r.source,
      subject: r.subject,
      description: r.description,
      status: r.status,
      priority: r.priority,
      assigneeId: r.assignee_id,
      countryCode: r.country_code,
      tags: r.tags || [],
      externalUrl: r.external_url,
      reporterId: r.reporter_id,
      snoozedUntil: r.snoozed_until,
      sourceCreatedAt: r.source_created_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return NextResponse.json({ items, page, limit });
  } catch (err) {
    console.error('[tasks GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { externalId, source, subject, description, priority, assigneeId, countryCode, tags, externalUrl } = body;

    if (!subject) return NextResponse.json({ error: 'Subject required' }, { status: 400 });

    const { rows } = await query(
      `INSERT INTO tasks (external_id, source, subject, description, priority, assignee_id, country_code, tags, external_url, source_created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING *`,
      [externalId || null, source || 'manual', subject, description || '', priority || 'medium', assigneeId || null, countryCode || null, tags || [], externalUrl || null]
    );

    const r = rows[0];
    return NextResponse.json({
      id: r.id, externalId: r.external_id, source: r.source, subject: r.subject,
      description: r.description, status: r.status, priority: r.priority,
      assigneeId: r.assignee_id, countryCode: r.country_code, tags: r.tags,
      externalUrl: r.external_url, reporterId: r.reporter_id,
      sourceCreatedAt: r.source_created_at, createdAt: r.created_at, updatedAt: r.updated_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[tasks POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

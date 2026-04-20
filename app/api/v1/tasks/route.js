import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { getVisibleMemberEmails, isAdmin } from '../../../../src/lib/scope-helpers';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const source = searchParams.get('source');
    const country = searchParams.get('country');
    const search = searchParams.get('search');
    const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 500);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const offset = (page - 1) * limit;

    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    // Role-based scoping — mirrors src/utils/permissions.js#scopeTasks so the
    // FE and BE agree on what each role can see:
    //   admin / regional_manager → everything (no filter)
    //   team_lead                → own + direct reports' tasks + unassigned
    //   agent                    → own tasks only
    if (!isAdmin(user) && user.role !== 'regional_manager') {
      const visible = [...getVisibleMemberEmails(user)];
      const allowUnassigned = user.role === 'team_lead';
      if (visible.length === 0) {
        // No hierarchy resolved — fall back to self-only to be safe.
        whereSql += ` AND t.assignee_id IN (SELECT id FROM members WHERE LOWER(email) = LOWER($${idx}))`;
        params.push(user.email);
        idx++;
      } else {
        const placeholders = visible.map(() => { const p = `$${idx}`; idx++; return p; }).join(',');
        if (allowUnassigned) {
          whereSql += ` AND (t.assignee_id IN (SELECT id FROM members WHERE LOWER(email) IN (${placeholders})) OR t.assignee_id IS NULL)`;
        } else {
          whereSql += ` AND t.assignee_id IN (SELECT id FROM members WHERE LOWER(email) IN (${placeholders}))`;
        }
        for (const e of visible) params.push(e.toLowerCase());
      }
    }

    if (status) { whereSql += ` AND status = $${idx++}`; params.push(status); }
    if (source) { whereSql += ` AND source = $${idx++}`; params.push(source); }
    if (country) { whereSql += ` AND country_code = $${idx++}`; params.push(country); }
    if (search) { whereSql += ` AND (subject ILIKE $${idx} OR description ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const countSql = 'SELECT COUNT(*) FROM tasks' + whereSql;
    const dataSql = 'SELECT id, external_id, subject, status, priority, source, country_code, assignee_id, sla_mins, tags, snoozed_until, created_at, updated_at FROM tasks' + whereSql + ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const [{ rows }, countResult] = await Promise.all([
      query(dataSql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    // Map DB columns to API response shape
    const items = rows.map(r => ({
      id: r.id,
      externalId: r.external_id,
      source: r.source,
      subject: r.subject,
      status: r.status,
      priority: r.priority,
      assigneeId: r.assignee_id,
      countryCode: r.country_code,
      tags: r.tags || [],
      snoozedUntil: r.snoozed_until,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[tasks GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  const postUser = getAuthUser(req);
  if (!postUser.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const { externalId, source, subject, description, priority, assigneeId, countryCode, tags, externalUrl } = body;

    if (!subject) return NextResponse.json({ error: 'Subject required' }, { status: 400 });

    // Validate enums
    const VALID_STATUSES = ['open', 'in_progress', 'escalated', 'snoozed', 'resolved', 'closed'];
    const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];
    const VALID_SOURCES = ['zendesk', 'jira', 'gmail', 'slack', 'calendar', 'looker', 'workbench', 'onboarding', 'offboarding', 'change_request', 'manual'];

    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` }, { status: 400 });
    }
    if (source && !VALID_SOURCES.includes(source)) {
      return NextResponse.json({ error: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}` }, { status: 400 });
    }

    // Length limits
    if (subject && subject.length > 500) {
      return NextResponse.json({ error: 'Subject must be 500 characters or less' }, { status: 400 });
    }
    if (description && description.length > 10000) {
      return NextResponse.json({ error: 'Description must be 10000 characters or less' }, { status: 400 });
    }
    if (tags && tags.length > 20) {
      return NextResponse.json({ error: 'Maximum 20 tags allowed' }, { status: 400 });
    }

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

// ── /api/v1/work-projects (Phase 3, 2026-05-25) ────────────────────────────
// GET  — list active projects scoped to the caller's dept.
//          ?include_archived=1 for the manage view.
// POST — create a project. Body: { name, description?, color?, icon?,
//          ownerEmails?, memberEmails?, dueDate? }. Creator is auto-added
//          to owner_emails so they keep edit power.

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { getCurrentDeptId } from '../../../../src/lib/dept-scope';
import {
  validateRosterEmails,
} from '../../../../src/lib/work-tasks-helpers';

const NAME_MAX = 255;
const DESCRIPTION_MAX = 4000;
const COLOR_MAX = 20;
const ICON_MAX = 60;

function rowToProject(r) {
  if (!r) return null;
  return {
    id: r.id,
    orgNodeId: r.org_node_id,
    name: r.name,
    description: r.description || '',
    status: r.status,
    color: r.color || null,
    icon: r.icon || null,
    creator: { email: r.creator_email },
    owners: r.owner_emails || [],
    members: r.member_emails || [],
    dueDate: r.due_date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    taskCount: Number.isFinite(Number(r.task_count)) ? Number(r.task_count) : 0,
  };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deptId = await getCurrentDeptId(user, req);
  if (!deptId) return NextResponse.json({ projects: [] });

  const { searchParams } = new URL(req.url);
  const includeArchived = searchParams.get('include_archived') === '1';

  try {
    const { rows } = await query(
      `SELECT p.id, p.org_node_id, p.name, p.description, p.status, p.color, p.icon,
              p.creator_email, p.owner_emails, p.member_emails, p.due_date,
              p.created_at, p.updated_at,
              (SELECT COUNT(*)::int FROM work_tasks t
                WHERE t.project_id = p.id AND t.is_archived = false) AS task_count
         FROM work_projects p
        WHERE p.org_node_id = $1
          ${includeArchived ? '' : `AND p.status <> 'archived'`}
        ORDER BY
          CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
          p.name`,
      [deptId],
    );
    return NextResponse.json({ projects: rows.map(rowToProject) });
  } catch (err) {
    console.error('[work-projects GET]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const deptId = await getCurrentDeptId(user, req);
  if (!deptId) {
    return NextResponse.json({ error: 'No department resolved for your account' }, { status: 400 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const name = String(body?.name || '').trim().slice(0, NAME_MAX);
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const description = body?.description == null
    ? null
    : String(body.description).slice(0, DESCRIPTION_MAX);
  const color = body?.color ? String(body.color).slice(0, COLOR_MAX) : null;
  const icon = body?.icon ? String(body.icon).slice(0, ICON_MAX) : null;
  const dueDate = body?.dueDate ? new Date(body.dueDate) : null;
  if (dueDate && !Number.isFinite(dueDate.getTime())) {
    return NextResponse.json({ error: 'dueDate must parse to a valid date' }, { status: 400 });
  }

  let owners, members;
  try {
    owners = await validateRosterEmails(body?.ownerEmails, { max: 24, label: 'ownerEmails' });
    members = await validateRosterEmails(body?.memberEmails, { max: 100, label: 'memberEmails' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 400 });
  }

  // Creator is always an owner -- guarantees the creator keeps edit power
  // even if they forgot to add themselves explicitly.
  const creatorLc = user.email.toLowerCase();
  if (!owners.includes(creatorLc)) owners = [creatorLc, ...owners];

  try {
    const { rows } = await query(
      `INSERT INTO work_projects (
         org_node_id, name, description, color, icon, creator_email,
         owner_emails, member_emails, due_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, org_node_id, name, description, status, color, icon,
                 creator_email, owner_emails, member_emails, due_date,
                 created_at, updated_at`,
      [deptId, name, description, color, icon, creatorLc, owners, members, dueDate],
    );
    return NextResponse.json({ project: rowToProject(rows[0]) }, { status: 201 });
  } catch (err) {
    console.error('[work-projects POST]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

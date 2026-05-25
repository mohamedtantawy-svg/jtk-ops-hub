// ── /api/v1/work-projects/[projectId] (Phase 3, 2026-05-25) ────────────────
// PATCH  — partial update. Owners + dept admin can edit any field.
// DELETE — soft-delete (sets status='archived'). Same auth as PATCH.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canManageOrgNode } from '../../../../../src/lib/org-admin';
import { validateRosterEmails } from '../../../../../src/lib/work-tasks-helpers';

const NAME_MAX = 255;
const DESCRIPTION_MAX = 4000;
const COLOR_MAX = 20;
const ICON_MAX = 60;
const VALID_STATUSES = new Set(['active', 'paused', 'completed', 'archived']);

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
  };
}

async function fetchProject(id) {
  const { rows } = await query(
    `SELECT id, org_node_id, name, description, status, color, icon,
            creator_email, owner_emails, member_emails, due_date,
            created_at, updated_at
       FROM work_projects WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

function canEditProject(user, project, isDeptAdmin) {
  if (!user?.email || !project) return false;
  if (isDeptAdmin) return true;
  const lc = user.email.toLowerCase();
  if ((project.creator_email || '').toLowerCase() === lc) return true;
  if ((project.owner_emails || []).some(e => String(e).toLowerCase() === lc)) return true;
  return false;
}

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { projectId } = await params;

  const existing = await fetchProject(projectId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const isDeptAdmin = existing.org_node_id
    ? await canManageOrgNode(user, existing.org_node_id)
    : false;
  if (!canEditProject(user, existing, isDeptAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const sets = [];
  const values = [];
  let i = 1;

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const v = String(body.name || '').trim().slice(0, NAME_MAX);
    if (!v) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    sets.push(`name = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const v = body.description == null ? null : String(body.description).slice(0, DESCRIPTION_MAX);
    sets.push(`description = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    if (!VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    sets.push(`status = $${i++}`); values.push(body.status);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'color')) {
    const v = body.color ? String(body.color).slice(0, COLOR_MAX) : null;
    sets.push(`color = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'icon')) {
    const v = body.icon ? String(body.icon).slice(0, ICON_MAX) : null;
    sets.push(`icon = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'ownerEmails')) {
    let v;
    try { v = await validateRosterEmails(body.ownerEmails, { max: 24, label: 'ownerEmails' }); }
    catch (err) { return NextResponse.json({ error: err.message }, { status: err.status || 400 }); }
    // Always keep the creator in owners — protects against accidental
    // self-lockout on edit. Dept admins can fully replace via the
    // creator path if needed.
    const creatorLc = (existing.creator_email || '').toLowerCase();
    if (creatorLc && !v.includes(creatorLc)) v = [creatorLc, ...v];
    sets.push(`owner_emails = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'memberEmails')) {
    let v;
    try { v = await validateRosterEmails(body.memberEmails, { max: 100, label: 'memberEmails' }); }
    catch (err) { return NextResponse.json({ error: err.message }, { status: err.status || 400 }); }
    sets.push(`member_emails = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dueDate')) {
    if (body.dueDate == null || body.dueDate === '') {
      sets.push(`due_date = $${i++}`); values.push(null);
    } else {
      const d = new Date(body.dueDate);
      if (!Number.isFinite(d.getTime())) {
        return NextResponse.json({ error: 'dueDate must parse to a valid date' }, { status: 400 });
      }
      sets.push(`due_date = $${i++}`); values.push(d);
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }
  sets.push(`updated_at = NOW()`);
  values.push(projectId);

  try {
    const { rows } = await query(
      `UPDATE work_projects SET ${sets.join(', ')}
        WHERE id = $${i}
        RETURNING id, org_node_id, name, description, status, color, icon,
                  creator_email, owner_emails, member_emails, due_date,
                  created_at, updated_at`,
      values,
    );
    return NextResponse.json({ project: rowToProject(rows[0]) });
  } catch (err) {
    console.error('[work-projects/:id PATCH]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { projectId } = await params;

  const existing = await fetchProject(projectId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const isDeptAdmin = existing.org_node_id
    ? await canManageOrgNode(user, existing.org_node_id)
    : false;
  if (!canEditProject(user, existing, isDeptAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await query(
      `UPDATE work_projects SET status = 'archived', updated_at = NOW()
        WHERE id = $1 AND status <> 'archived'`,
      [projectId],
    );
    return NextResponse.json({ archived: true });
  } catch (err) {
    console.error('[work-projects/:id DELETE]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

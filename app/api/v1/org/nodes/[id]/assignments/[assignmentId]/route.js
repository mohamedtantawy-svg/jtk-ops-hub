// ── /api/v1/org/nodes/[id]/assignments/[assignmentId] (Phase 12a) ──────────
// PATCH  — update fields on a single assignment row. Body accepts any subset
//          of { name, description, assignees, backups, sortOrder, kind }.
// DELETE — soft-delete (sets is_archived=true). Hard delete is intentionally
//          NOT supported via the UI — every removal stays auditable.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../../src/lib/auth-helpers';
import { canManageOrgNode } from '../../../../../../../../src/lib/org-admin';
import { rowToAssignment } from '../route';

const VALID_KINDS = new Set(['swat_function', 'responsibility']);
const NAME_MAX = 255;
const DESCRIPTION_MAX = 2000;
const MAX_OWNERS_PER_FIELD = 24;

function normaliseEmails(raw, label) {
  if (raw == null) return null;          // null means "leave as-is"
  if (!Array.isArray(raw)) {
    const err = new Error(`${label} must be an array of email strings`);
    err.status = 400;
    throw err;
  }
  const out = [];
  const seen = new Set();
  for (const e of raw) {
    if (typeof e !== 'string') continue;
    const lc = e.trim().toLowerCase();
    if (!lc) continue;
    if (!lc.includes('@') || !lc.endsWith('@deel.com')) {
      const err = new Error(`${label} must be valid @deel.com addresses (got "${e}")`);
      err.status = 400;
      throw err;
    }
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(lc);
    if (out.length > MAX_OWNERS_PER_FIELD) {
      const err = new Error(`${label} cannot exceed ${MAX_OWNERS_PER_FIELD} entries`);
      err.status = 400;
      throw err;
    }
  }
  return out;
}

async function fetchAssignment(assignmentId) {
  const { rows } = await query(
    `SELECT id, node_id, kind, name, description, assignee_emails, backup_emails,
            sort_order, is_archived, created_at, updated_at, created_by, updated_by
       FROM org_node_assignments WHERE id = $1 LIMIT 1`,
    [assignmentId],
  );
  return rows[0] || null;
}

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, assignmentId } = await params;
  if (!(await canManageOrgNode(user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const existing = await fetchAssignment(assignmentId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.node_id !== id) {
    return NextResponse.json({ error: 'Assignment does not belong to this node' }, { status: 400 });
  }
  if (existing.is_archived) {
    return NextResponse.json({ error: 'Restore the assignment before editing it' }, { status: 409 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const sets = [];
  const values = [];
  let i = 1;

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.name || '').trim().slice(0, NAME_MAX);
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    sets.push(`name = $${i++}`); values.push(name);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const v = body.description == null ? null : String(body.description).slice(0, DESCRIPTION_MAX);
    sets.push(`description = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'assignees')) {
    let v;
    try { v = normaliseEmails(body.assignees, 'assignees'); }
    catch (err) { return NextResponse.json({ error: err.message }, { status: err.status || 400 }); }
    sets.push(`assignee_emails = $${i++}`); values.push(v ?? []);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'backups')) {
    let v;
    try { v = normaliseEmails(body.backups, 'backups'); }
    catch (err) { return NextResponse.json({ error: err.message }, { status: err.status || 400 }); }
    sets.push(`backup_emails = $${i++}`); values.push(v ?? []);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: 'sortOrder must be a number' }, { status: 400 });
    }
    sets.push(`sort_order = $${i++}`); values.push(Math.floor(n));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'kind')) {
    const k = String(body.kind || '').trim();
    if (!VALID_KINDS.has(k)) {
      return NextResponse.json({ error: `kind must be one of: ${Array.from(VALID_KINDS).join(', ')}` }, { status: 400 });
    }
    sets.push(`kind = $${i++}`); values.push(k);
  }

  if (!sets.length) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }
  sets.push(`updated_at = NOW()`);
  sets.push(`updated_by = $${i++}`); values.push(user.email.toLowerCase());
  values.push(assignmentId);

  try {
    const { rows } = await query(
      `UPDATE org_node_assignments SET ${sets.join(', ')}
        WHERE id = $${i}
        RETURNING id, node_id, kind, name, description, assignee_emails, backup_emails,
                  sort_order, is_archived, created_at, updated_at, created_by, updated_by`,
      values,
    );
    const after = rowToAssignment(rows[0]);

    try {
      await query(
        `INSERT INTO org_audit (actor_email, action, target_kind, target_id, before_json, after_json, metadata)
         VALUES ($1, 'assignment.update', 'assignment', $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
        [
          user.email.toLowerCase(),
          assignmentId,
          JSON.stringify(rowToAssignment(existing)),
          JSON.stringify(after),
          JSON.stringify({ nodeId: id, patchedFields: Object.keys(body) }),
        ],
      );
    } catch (err) {
      console.warn('[org-assignments PATCH] audit insert failed:', err?.message);
    }

    return NextResponse.json({ assignment: after });
  } catch (err) {
    console.error('[org/nodes/:id/assignments/:aid PATCH]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, assignmentId } = await params;
  if (!(await canManageOrgNode(user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const existing = await fetchAssignment(assignmentId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.node_id !== id) {
    return NextResponse.json({ error: 'Assignment does not belong to this node' }, { status: 400 });
  }

  try {
    await query(
      `UPDATE org_node_assignments
          SET is_archived = true, updated_at = NOW(), updated_by = $1
        WHERE id = $2 AND is_archived = false`,
      [user.email.toLowerCase(), assignmentId],
    );

    try {
      await query(
        `INSERT INTO org_audit (actor_email, action, target_kind, target_id, before_json, metadata)
         VALUES ($1, 'assignment.archive', 'assignment', $2, $3::jsonb, $4::jsonb)`,
        [
          user.email.toLowerCase(),
          assignmentId,
          JSON.stringify(rowToAssignment(existing)),
          JSON.stringify({ nodeId: id }),
        ],
      );
    } catch (err) {
      console.warn('[org-assignments DELETE] audit insert failed:', err?.message);
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[org/nodes/:id/assignments/:aid DELETE]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

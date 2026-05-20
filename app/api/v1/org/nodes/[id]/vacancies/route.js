// ── /api/v1/org/nodes/[id]/vacancies (Phase 5, 2026-05-20) ─────────────────
// GET     — list vacant role placeholders under a node.
// POST    — add a vacancy (body: { title, notes? }).
// DELETE  — body: { vacancyId } removes a single placeholder.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { canManageOrgNode } from '../../../../../../../src/lib/org-admin';

const TITLE_MAX = 255;
const NOTES_MAX = 2000;

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { rows } = await query(
    `SELECT id, title, notes, created_at, created_by
       FROM org_vacant_roles WHERE node_id = $1
      ORDER BY created_at DESC`,
    [id],
  );
  return NextResponse.json({ vacancies: rows });
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await canManageOrgNode(user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const title = String(body?.title || '').trim().slice(0, TITLE_MAX);
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
  const notes = body?.notes ? String(body.notes).slice(0, NOTES_MAX) : null;

  const { rows } = await query(
    `INSERT INTO org_vacant_roles (node_id, title, notes, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, notes, created_at, created_by`,
    [id, title, notes, user.email.toLowerCase()],
  );
  await query(
    `INSERT INTO org_audit (actor_email, action, target_kind, target_id, after_json, metadata)
     VALUES ($1, 'vacancy.create', 'vacancy', $2, $3::jsonb, $4::jsonb)`,
    [user.email.toLowerCase(), rows[0].id, JSON.stringify(rows[0]), JSON.stringify({ nodeId: id })],
  );
  return NextResponse.json({ vacancy: rows[0] }, { status: 201 });
}

export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await canManageOrgNode(user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const vacancyId = body?.vacancyId;
  if (!vacancyId) return NextResponse.json({ error: 'vacancyId is required' }, { status: 400 });
  const { rowCount } = await query(
    `DELETE FROM org_vacant_roles WHERE id = $1 AND node_id = $2`,
    [vacancyId, id],
  );
  if (rowCount > 0) {
    await query(
      `INSERT INTO org_audit (actor_email, action, target_kind, target_id, metadata)
       VALUES ($1, 'vacancy.delete', 'vacancy', $2, $3::jsonb)`,
      [user.email.toLowerCase(), vacancyId, JSON.stringify({ nodeId: id })],
    );
  }
  return NextResponse.json({ deleted: rowCount > 0 });
}

// ── /api/v1/org/nodes/[id]/reorder (Phase 1, 2026-05-20) ───────────────────
// POST { newSortOrder: number }
// Updates a single node's sort_order. Admin UI does this for manual
// sibling ordering; bulk reordering can call /reorder multiple times.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { canManageOrgNode } from '../../../../../../../src/lib/org-admin';

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!(await canManageOrgNode(user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const newSortOrder = Number(body?.newSortOrder);
  if (!Number.isFinite(newSortOrder)) {
    return NextResponse.json({ error: 'newSortOrder must be a number' }, { status: 400 });
  }

  const { rows } = await query(
    `UPDATE org_nodes
        SET sort_order = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, parent_id, sort_order`,
    [newSortOrder, id],
  );
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await query(
    `INSERT INTO org_audit
       (actor_email, action, target_kind, target_id, after_json, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      user.email.toLowerCase(),
      'node.reorder',
      'node',
      id,
      JSON.stringify(rows[0]),
      JSON.stringify({ newSortOrder }),
    ],
  );

  return NextResponse.json({ node: {
    id: rows[0].id,
    parentId: rows[0].parent_id,
    sortOrder: rows[0].sort_order,
  }});
}

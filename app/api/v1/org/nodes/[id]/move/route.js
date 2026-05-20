// ── /api/v1/org/nodes/[id]/move (Phase 1, 2026-05-20) ──────────────────────
// POST — re-parent a node. Validates kind rules, cycle prevention, depth
// cap, and unique sibling name at the new parent. Writes org_audit.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { canManageOrgNode } from '../../../../../../../src/lib/org-admin';

const MAX_DEPTH = 6;

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const targetParentId = body?.parentId === null || body?.parentId === undefined
    ? null
    : String(body.parentId);

  // Edit power required on BOTH source and target parents — preventing a
  // delegated team-admin from offloading their subtree somewhere they
  // don't admin.
  if (!(await canManageOrgNode(user, id))) {
    return NextResponse.json({ error: 'Forbidden (source)' }, { status: 403 });
  }
  if (targetParentId && !(await canManageOrgNode(user, targetParentId))) {
    return NextResponse.json({ error: 'Forbidden (target)' }, { status: 403 });
  }

  const { rows: srcRows } = await query(
    `SELECT * FROM org_nodes WHERE id = $1`,
    [id],
  );
  const node = srcRows[0];
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (node.is_archived) {
    return NextResponse.json({ error: 'Restore the node before moving it' }, { status: 409 });
  }
  if (node.parent_id === targetParentId) {
    return NextResponse.json({ error: 'Already at this parent' }, { status: 400 });
  }

  let targetKind = null;
  if (targetParentId) {
    const { rows: parentRows } = await query(
      `SELECT id, kind, is_archived FROM org_nodes WHERE id = $1`,
      [targetParentId],
    );
    if (!parentRows[0]) {
      return NextResponse.json({ error: 'Target parent not found' }, { status: 404 });
    }
    if (parentRows[0].is_archived) {
      return NextResponse.json({ error: 'Target parent is archived' }, { status: 409 });
    }
    targetKind = parentRows[0].kind;
    if (node.kind === 'department' && targetKind !== 'department') {
      return NextResponse.json(
        { error: 'Departments can only nest under other departments' },
        { status: 400 },
      );
    }
  } else if (node.kind === 'team') {
    return NextResponse.json(
      { error: 'A team must have a parent department' },
      { status: 400 },
    );
  }

  // Cycle prevention: targetParentId must not be a descendant of this node.
  if (targetParentId) {
    const { rows: cycle } = await query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM org_nodes WHERE id = $1
         UNION ALL
         SELECT n.id FROM org_nodes n
           JOIN descendants d ON n.parent_id = d.id
       )
       SELECT 1 FROM descendants WHERE id = $2 LIMIT 1`,
      [id, targetParentId],
    );
    if (cycle.length) {
      return NextResponse.json(
        { error: 'Cannot move a node inside its own descendants (cycle)' },
        { status: 400 },
      );
    }
  }

  // Depth cap — measure the deepest descendant + new parent depth.
  const { rows: depthRows } = await query(
    `WITH RECURSIVE down AS (
       SELECT id, 0 AS d FROM org_nodes WHERE id = $1
       UNION ALL
       SELECT n.id, down.d + 1 FROM org_nodes n
         JOIN down ON n.parent_id = down.id
     )
     SELECT MAX(d) AS subtree_depth FROM down`,
    [id],
  );
  const subtreeDepth = Number(depthRows[0]?.subtree_depth) || 0;

  let parentDepth = 0;
  if (targetParentId) {
    const { rows: pdRows } = await query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_id, 1 AS depth FROM org_nodes WHERE id = $1
         UNION ALL
         SELECT n.id, n.parent_id, c.depth + 1
           FROM org_nodes n
           JOIN chain c ON n.id = c.parent_id
       )
       SELECT MAX(depth) AS depth FROM chain`,
      [targetParentId],
    );
    parentDepth = Number(pdRows[0]?.depth) || 1;
  }
  if (parentDepth + subtreeDepth + 1 > MAX_DEPTH) {
    return NextResponse.json(
      { error: `Move would exceed hierarchy depth cap (${MAX_DEPTH})` },
      { status: 400 },
    );
  }

  // Sibling-name uniqueness at the new parent.
  const { rows: clash } = await query(
    `SELECT 1 FROM org_nodes
      WHERE COALESCE(parent_id::text, '') = COALESCE($1::text, '')
        AND LOWER(name) = LOWER($2)
        AND id <> $3
        AND is_archived = false
      LIMIT 1`,
    [targetParentId, node.name, id],
  );
  if (clash.length) {
    return NextResponse.json(
      { error: 'A sibling with this name already exists under the target parent — rename first' },
      { status: 409 },
    );
  }

  // Place at the end of the target parent's children.
  const { rows: maxRows } = await query(
    `SELECT COALESCE(MAX(sort_order), -1) + 10 AS next_order
       FROM org_nodes
      WHERE COALESCE(parent_id::text, '') = COALESCE($1::text, '')`,
    [targetParentId],
  );

  const { rows: updated } = await query(
    `UPDATE org_nodes
        SET parent_id = $1, sort_order = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [targetParentId, Number(maxRows[0]?.next_order || 0), id],
  );

  await query(
    `INSERT INTO org_audit
       (actor_email, action, target_kind, target_id, before_json, after_json, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
    [
      user.email.toLowerCase(),
      'node.move',
      'node',
      id,
      JSON.stringify(node),
      JSON.stringify(updated[0]),
      JSON.stringify({ fromParentId: node.parent_id, toParentId: targetParentId }),
    ],
  );

  return NextResponse.json({ node: {
    id: updated[0].id,
    parentId: updated[0].parent_id,
    kind: updated[0].kind,
    name: updated[0].name,
    sortOrder: updated[0].sort_order,
    updatedAt: updated[0].updated_at,
  }});
}

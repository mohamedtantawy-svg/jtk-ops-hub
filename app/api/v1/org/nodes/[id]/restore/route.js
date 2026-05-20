// ── /api/v1/org/nodes/[id]/restore (Phase 8, 2026-05-20) ──────────────────
// POST — flip is_archived back to false for a previously-archived node.
// Refuses when the parent is itself archived (would leave the restored
// node orphaned). Writes an org_audit row so the action is traceable.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { canManageOrgNode } from '../../../../../../../src/lib/org-admin';

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await canManageOrgNode(user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { rows: srcRows } = await query(`SELECT * FROM org_nodes WHERE id = $1`, [id]);
  const node = srcRows[0];
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!node.is_archived) {
    return NextResponse.json({ error: 'Node is not archived' }, { status: 409 });
  }

  if (node.parent_id) {
    const { rows: parentRows } = await query(
      `SELECT is_archived FROM org_nodes WHERE id = $1`,
      [node.parent_id],
    );
    if (parentRows[0]?.is_archived) {
      return NextResponse.json(
        { error: 'Parent node is archived — restore the parent first' },
        { status: 409 },
      );
    }
  }

  // Sibling-name collision: if a non-archived sibling now holds the same
  // name (someone created a replacement after the archive), surface a
  // clear error so the admin can rename one before restoring.
  const { rows: clashRows } = await query(
    `SELECT 1 FROM org_nodes
      WHERE COALESCE(parent_id::text, '') = COALESCE($1::text, '')
        AND LOWER(name) = LOWER($2)
        AND id <> $3
        AND is_archived = false
      LIMIT 1`,
    [node.parent_id, node.name, id],
  );
  if (clashRows.length) {
    return NextResponse.json(
      { error: 'A sibling with the same name now exists. Rename one before restoring.' },
      { status: 409 },
    );
  }

  const { rows: updated } = await query(
    `UPDATE org_nodes
        SET is_archived = false, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id],
  );
  const after = updated[0];

  await query(
    `INSERT INTO org_audit
       (actor_email, action, target_kind, target_id, before_json, after_json, metadata)
     VALUES ($1, 'node.restore', 'node', $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
    [
      user.email.toLowerCase(),
      id,
      JSON.stringify(node),
      JSON.stringify(after),
      JSON.stringify({ restored: true }),
    ],
  );

  return NextResponse.json({ node: {
    id: after.id,
    parentId: after.parent_id,
    kind: after.kind,
    name: after.name,
    isArchived: after.is_archived,
    updatedAt: after.updated_at,
  }});
}

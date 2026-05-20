// ── /api/v1/org/nodes/[id]/admins (Phase 5, 2026-05-20) ────────────────────
// GET     — list delegated admins for a node.
// POST    — grant a delegated admin (body: { email }).
// DELETE  — body: { email } revokes a grant. Plain DELETE on /admins is the
//           cleanest REST pairing here since there are only ever a handful
//           of grants per node.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { canManageOrgNode, bustOrgAdminCache } from '../../../../../../../src/lib/org-admin';

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { rows } = await query(
    `SELECT email, granted_at, granted_by FROM org_node_admins WHERE node_id = $1 ORDER BY granted_at`,
    [id],
  );
  return NextResponse.json({
    admins: rows.map(r => ({ email: r.email, grantedAt: r.granted_at, grantedBy: r.granted_by })),
  });
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
  const email = String(body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@') || !email.endsWith('@deel.com')) {
    return NextResponse.json({ error: 'A @deel.com email is required' }, { status: 400 });
  }

  try {
    await query(
      `INSERT INTO org_node_admins (node_id, email, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (node_id, email) DO NOTHING`,
      [id, email, user.email.toLowerCase()],
    );
    await query(
      `INSERT INTO org_audit (actor_email, action, target_kind, target_id, metadata)
       VALUES ($1, 'node.admin.grant', 'node', $2, $3::jsonb)`,
      [user.email.toLowerCase(), id, JSON.stringify({ grantedTo: email })],
    );
    bustOrgAdminCache(email, id);
    return NextResponse.json({ email, grantedBy: user.email.toLowerCase() }, { status: 201 });
  } catch (err) {
    console.error('[org/nodes/:id/admins POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
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
  const email = String(body?.email || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });
  try {
    const { rowCount } = await query(
      `DELETE FROM org_node_admins WHERE node_id = $1 AND LOWER(email) = $2`,
      [id, email],
    );
    if (rowCount > 0) {
      await query(
        `INSERT INTO org_audit (actor_email, action, target_kind, target_id, metadata)
         VALUES ($1, 'node.admin.revoke', 'node', $2, $3::jsonb)`,
        [user.email.toLowerCase(), id, JSON.stringify({ revokedFrom: email })],
      );
      bustOrgAdminCache(email, id);
    }
    return NextResponse.json({ revoked: rowCount > 0 });
  } catch (err) {
    console.error('[org/nodes/:id/admins DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

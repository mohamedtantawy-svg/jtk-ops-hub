// ── /api/v1/org/nodes/[id] (Phase 1, 2026-05-20) ────────────────────────────
// GET    — single node + its delegated admin emails + vacant roles
// PATCH  — rename / re-color / re-icon / re-lead / re-countries / re-slack
// DELETE — soft-delete (is_archived = true). Refuses if the node has
//          active children or active members. Members must be moved out
//          first via the per-member API (Phase 3) or bulk-move flow
//          (Phase 4).
//
// All mutations write to org_audit with before/after snapshots.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { canManageOrgNode, bustOrgAdminCache } from '../../../../../../src/lib/org-admin';

const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;
const COLOR_MAX = 20;
const ICON_MAX = 60;
const SLACK_CHANNEL_MAX = 120;

function rowToNode(r) {
  return {
    id: r.id,
    parentId: r.parent_id,
    kind: r.kind,
    name: r.name,
    slug: r.slug,
    description: r.description,
    leadEmail: r.lead_email,
    color: r.color,
    icon: r.icon,
    slackChannel: r.slack_channel,
    countryCodes: r.country_codes || [],
    sortOrder: r.sort_order,
    isArchived: r.is_archived,
    config: r.config || {},
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
  };
}

async function fetchNode(id) {
  const { rows } = await query(`SELECT * FROM org_nodes WHERE id = $1`, [id]);
  return rows[0] || null;
}

// ──────────────────────────────────────────────────────────────────────────
//  GET
// ──────────────────────────────────────────────────────────────────────────
export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const row = await fetchNode(id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [adminsRes, vacantRes, memberRes] = await Promise.all([
      query(
        `SELECT email, granted_at, granted_by
           FROM org_node_admins WHERE node_id = $1
          ORDER BY granted_at`,
        [id],
      ),
      query(
        `SELECT id, title, notes, created_at
           FROM org_vacant_roles WHERE node_id = $1
          ORDER BY created_at DESC`,
        [id],
      ),
      query(
        `SELECT COUNT(*)::int AS direct_count
           FROM team_member_overrides
          WHERE org_node_id = $1
            AND (is_deleted IS NULL OR is_deleted = false)`,
        [id],
      ),
    ]);

    return NextResponse.json({
      node: rowToNode(row),
      delegatedAdmins: adminsRes.rows.map(r => ({
        email: r.email,
        grantedAt: r.granted_at,
        grantedBy: r.granted_by,
      })),
      vacantRoles: vacantRes.rows,
      directMemberCount: memberRes.rows[0]?.direct_count || 0,
    });
  } catch (err) {
    console.error('[org/nodes/:id GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  PATCH
// ──────────────────────────────────────────────────────────────────────────
export async function PATCH(req, { params }) {
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

  const existing = await fetchNode(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.is_archived) {
    return NextResponse.json({ error: 'Restore the node before editing it' }, { status: 409 });
  }

  // Build the SET clause from only the fields the caller supplied so a
  // PATCH with `{ name: "..." }` doesn't blank out countryCodes.
  const sets = [];
  const values = [];
  let i = 1;

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.name || '').trim();
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    if (name.length > NAME_MAX) {
      return NextResponse.json({ error: `name must be ${NAME_MAX} characters or fewer` }, { status: 400 });
    }
    // Sibling-name collision check (case-insensitive, ignoring this row).
    const { rows: clash } = await query(
      `SELECT 1 FROM org_nodes
        WHERE COALESCE(parent_id::text, '') = COALESCE($1::text, '')
          AND LOWER(name) = LOWER($2)
          AND id <> $3
          AND is_archived = false
        LIMIT 1`,
      [existing.parent_id, name, id],
    );
    if (clash.length) {
      return NextResponse.json(
        { error: 'A sibling with this name already exists under the same parent' },
        { status: 409 },
      );
    }
    sets.push(`name = $${i++}`); values.push(name);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const v = body.description == null ? null : String(body.description).slice(0, DESCRIPTION_MAX);
    sets.push(`description = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'leadEmail')) {
    const v = body.leadEmail ? String(body.leadEmail).trim().toLowerCase() : null;
    if (v && (!v.includes('@') || !v.endsWith('@deel.com'))) {
      return NextResponse.json({ error: 'leadEmail must be a valid @deel.com address' }, { status: 400 });
    }
    sets.push(`lead_email = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'color')) {
    const v = body.color ? String(body.color).slice(0, COLOR_MAX) : null;
    sets.push(`color = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'icon')) {
    const v = body.icon ? String(body.icon).slice(0, ICON_MAX) : null;
    sets.push(`icon = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'slackChannel')) {
    const v = body.slackChannel ? String(body.slackChannel).slice(0, SLACK_CHANNEL_MAX) : null;
    sets.push(`slack_channel = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'countryCodes')) {
    const v = Array.isArray(body.countryCodes)
      ? body.countryCodes.map(c => String(c).toUpperCase().slice(0, 2)).filter(c => /^[A-Z]{2}$/.test(c))
      : null;
    sets.push(`country_codes = $${i++}`); values.push(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'config') && body.config && typeof body.config === 'object') {
    sets.push(`config = $${i++}::jsonb`); values.push(JSON.stringify(body.config));
  }

  if (!sets.length) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }
  sets.push(`updated_at = NOW()`);
  values.push(id);

  try {
    const { rows } = await query(
      `UPDATE org_nodes SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    const after = rows[0];

    await query(
      `INSERT INTO org_audit
         (actor_email, action, target_kind, target_id, before_json, after_json, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
      [
        user.email.toLowerCase(),
        'node.update',
        'node',
        id,
        JSON.stringify(existing),
        JSON.stringify(after),
        JSON.stringify({ patchedFields: Object.keys(body) }),
      ],
    );

    return NextResponse.json({ node: rowToNode(after) });
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'A node with this name already exists at the same level' }, { status: 409 });
    }
    console.error('[org/nodes/:id PATCH]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  DELETE (soft delete)
// ──────────────────────────────────────────────────────────────────────────
export async function DELETE(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!(await canManageOrgNode(user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const existing = await fetchNode(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.is_archived) {
    return NextResponse.json({ error: 'Already archived' }, { status: 409 });
  }

  // Refuse if the node has active children or active members. Spec rule:
  // archiving forces a manual reassignment first so we never orphan rows.
  const [childRes, memberRes] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS n
         FROM org_nodes
        WHERE parent_id = $1 AND is_archived = false`,
      [id],
    ),
    query(
      `SELECT COUNT(*)::int AS n
         FROM team_member_overrides
        WHERE org_node_id = $1
          AND (is_deleted IS NULL OR is_deleted = false)`,
      [id],
    ),
  ]);
  const childCount = childRes.rows[0]?.n || 0;
  const memberCount = memberRes.rows[0]?.n || 0;
  if (childCount > 0 || memberCount > 0) {
    return NextResponse.json(
      {
        error: 'Cannot archive a node with active children or members',
        impact: { activeChildren: childCount, activeMembers: memberCount },
      },
      { status: 409 },
    );
  }

  const { rows } = await query(
    `UPDATE org_nodes
       SET is_archived = true, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  const after = rows[0];

  await query(
    `INSERT INTO org_audit
       (actor_email, action, target_kind, target_id, before_json, after_json, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
    [
      user.email.toLowerCase(),
      'node.archive',
      'node',
      id,
      JSON.stringify(existing),
      JSON.stringify(after),
      JSON.stringify({ softDelete: true }),
    ],
  );

  bustOrgAdminCache(null, id);

  return NextResponse.json({ node: rowToNode(after) });
}

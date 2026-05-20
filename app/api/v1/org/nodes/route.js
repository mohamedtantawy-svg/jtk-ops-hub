// ── /api/v1/org/nodes (Phase 1, 2026-05-20) ────────────────────────────────
// GET  — list the full active tree. Open to every authenticated user; the
//        response shape carries an `editPowers` object so the FE can render
//        edit affordances without a second roundtrip.
// POST — create a new node (department or team). Requires global org-admin
//        OR a per-node delegation for the parent. Writes an org_audit row.
//
// Soft-delete rules: archived nodes are excluded from the list view. The
// admin UI fetches archived nodes via ?include_archived=1 for restore flows
// (lands in Phase 7 — the parameter is wired now so the route is forward-
// compatible).

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canManageOrgGlobal, canManageOrgNode, hasAnyOrgEditPower } from '../../../../../src/lib/org-admin';
import { ensureLeadIsDeptAdmin } from '../../../../../src/lib/org-lead-admin-seed';

const VALID_KINDS = new Set(['department', 'team']);
const NAME_MAX = 120;
const SLUG_MAX = 160;
const DESCRIPTION_MAX = 2000;
const COLOR_MAX = 20;
const ICON_MAX = 60;
const SLACK_CHANNEL_MAX = 120;
const MAX_DEPTH = 6; // sanity guard — chart UI gets unreadable past this

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')          // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')              // collapse non-alphanumerics
    .replace(/(^-|-$)/g, '')                  // trim leading/trailing dashes
    .slice(0, SLUG_MAX);
}

async function uniqueSlug(base) {
  let candidate = base || `node-${Date.now().toString(36)}`;
  let suffix = 0;
  // Try the bare slug first; collide-and-retry with -2, -3, … until unique.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const trial = suffix === 0 ? candidate : `${candidate}-${suffix + 1}`;
    const { rows } = await query(
      `SELECT 1 FROM org_nodes WHERE slug = $1 LIMIT 1`,
      [trial],
    );
    if (!rows.length) return trial;
    suffix += 1;
  }
  // Fallback to a timestamped slug if 50 attempts all collided (shouldn't
  // happen short of an automated abuse pattern).
  return `${candidate}-${Date.now().toString(36)}`;
}

async function computeDepth(parentId) {
  if (!parentId) return 0;
  const { rows } = await query(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id, 1 AS depth FROM org_nodes WHERE id = $1
       UNION ALL
       SELECT n.id, n.parent_id, c.depth + 1
         FROM org_nodes n
         JOIN chain c ON n.id = c.parent_id
     )
     SELECT MAX(depth) AS depth FROM chain`,
    [parentId],
  );
  return Number(rows[0]?.depth) || 1;
}

// ──────────────────────────────────────────────────────────────────────────
//  GET
// ──────────────────────────────────────────────────────────────────────────
export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get('include_archived') === '1';

    const filter = includeArchived ? '' : 'WHERE is_archived = false';
    const { rows: nodeRows } = await query(
      `SELECT id, parent_id, kind, name, slug, description, lead_email,
              color, icon, slack_channel, country_codes, sort_order,
              is_archived, config, created_at, created_by, updated_at
         FROM org_nodes
         ${filter}
         ORDER BY COALESCE(parent_id::text, ''), sort_order, name`,
    );

    // Member counts per node (recursive headcount happens client-side; we
    // ship the per-node count so the UI doesn't traverse the tree twice).
    const { rows: countRows } = await query(
      `SELECT org_node_id, COUNT(*)::int AS member_count
         FROM team_member_overrides
         WHERE org_node_id IS NOT NULL
           AND (is_deleted IS NULL OR is_deleted = false)
         GROUP BY org_node_id`,
    );
    const memberCountByNode = Object.fromEntries(
      countRows.map(r => [r.org_node_id, r.member_count]),
    );

    // Vacant role count per node — same shape as member counts.
    const { rows: vacantRows } = await query(
      `SELECT node_id, COUNT(*)::int AS vacant_count
         FROM org_vacant_roles
         GROUP BY node_id`,
    );
    const vacantCountByNode = Object.fromEntries(
      vacantRows.map(r => [r.node_id, r.vacant_count]),
    );

    const nodes = nodeRows.map(r => ({
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
      memberCount: memberCountByNode[r.id] || 0,
      vacantCount: vacantCountByNode[r.id] || 0,
    }));

    return NextResponse.json({
      nodes,
      total: nodes.length,
      editPowers: {
        canManageGlobal: hasAnyOrgEditPower(user),
      },
    });
  } catch (err) {
    console.error('[org/nodes GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  POST — create a new node
// ──────────────────────────────────────────────────────────────────────────
export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const kind = String(body?.kind || '').trim().toLowerCase();
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: 'kind must be department or team' }, { status: 400 });
  }
  const name = String(body?.name || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (name.length > NAME_MAX) {
    return NextResponse.json({ error: `name must be ${NAME_MAX} characters or fewer` }, { status: 400 });
  }

  const parentId = body?.parentId || null;

  // Authorisation: creating under a parent requires manage power for that
  // parent. Creating a root node requires global power (delegated admins
  // cannot create new root departments).
  const canEdit = parentId
    ? await canManageOrgNode(user, parentId)
    : canManageOrgGlobal(user);
  if (!canEdit) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Parent existence + kind rules.
  let parentKind = null;
  if (parentId) {
    const { rows } = await query(
      `SELECT id, kind, is_archived FROM org_nodes WHERE id = $1`,
      [parentId],
    );
    if (!rows[0]) {
      return NextResponse.json({ error: 'Parent not found' }, { status: 404 });
    }
    if (rows[0].is_archived) {
      return NextResponse.json({ error: 'Parent is archived — restore it first' }, { status: 409 });
    }
    parentKind = rows[0].kind;
    // Spec rule: department's parent must be a department (or null). Teams
    // can sit under a department OR another team (which makes them a
    // sub-team).
    if (kind === 'department' && parentKind !== 'department') {
      return NextResponse.json(
        { error: 'A department can only be nested under another department' },
        { status: 400 },
      );
    }
  } else if (kind === 'team') {
    // Spec rule: teams cannot be root nodes — they always live under a
    // department (or another team).
    return NextResponse.json(
      { error: 'A team must have a parent department' },
      { status: 400 },
    );
  }

  // Depth cap.
  const depth = await computeDepth(parentId);
  if (depth >= MAX_DEPTH) {
    return NextResponse.json(
      { error: `Hierarchy depth cap (${MAX_DEPTH}) reached — cannot nest deeper` },
      { status: 400 },
    );
  }

  // Sibling-name uniqueness (case-insensitive) is enforced by a unique
  // index — but we surface a friendly error rather than the raw 23505.
  const { rows: sibRows } = await query(
    `SELECT 1 FROM org_nodes
      WHERE COALESCE(parent_id::text, '') = COALESCE($1::text, '')
        AND LOWER(name) = LOWER($2)
        AND is_archived = false
      LIMIT 1`,
    [parentId, name],
  );
  if (sibRows.length) {
    return NextResponse.json(
      { error: 'A sibling with this name already exists under the same parent' },
      { status: 409 },
    );
  }

  // Field sanitisation.
  const description = body?.description ? String(body.description).slice(0, DESCRIPTION_MAX) : null;
  const leadEmail = body?.leadEmail ? String(body.leadEmail).trim().toLowerCase() : null;
  if (leadEmail && (!leadEmail.includes('@') || !leadEmail.endsWith('@deel.com'))) {
    return NextResponse.json({ error: 'leadEmail must be a valid @deel.com address' }, { status: 400 });
  }
  const color = body?.color ? String(body.color).slice(0, COLOR_MAX) : null;
  const icon = body?.icon ? String(body.icon).slice(0, ICON_MAX) : null;
  const slackChannel = body?.slackChannel ? String(body.slackChannel).slice(0, SLACK_CHANNEL_MAX) : null;
  const countryCodes = Array.isArray(body?.countryCodes)
    ? body.countryCodes.map(c => String(c).toUpperCase().slice(0, 2)).filter(c => /^[A-Z]{2}$/.test(c))
    : null;
  // sort_order — default to a value larger than any existing sibling so new
  // nodes drop at the end. Admins reorder via the dedicated endpoint.
  const { rows: maxRows } = await query(
    `SELECT COALESCE(MAX(sort_order), -1) + 10 AS next_order
       FROM org_nodes
      WHERE COALESCE(parent_id::text, '') = COALESCE($1::text, '')`,
    [parentId],
  );
  const sortOrder = Number.isFinite(body?.sortOrder) ? Number(body.sortOrder) : Number(maxRows[0]?.next_order || 0);

  // Build slug — accept caller-supplied (after sanitisation) or derive.
  const slugBase = body?.slug ? slugify(body.slug) : slugify(name);
  const slug = await uniqueSlug(slugBase);

  try {
    const { rows: inserted } = await query(
      `INSERT INTO org_nodes
         (parent_id, kind, name, slug, description, lead_email,
          color, icon, slack_channel, country_codes, sort_order,
          config, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       RETURNING *`,
      [
        parentId, kind, name, slug, description, leadEmail,
        color, icon, slackChannel, countryCodes, sortOrder,
        JSON.stringify(body?.config && typeof body.config === 'object' ? body.config : {}),
        user.email.toLowerCase(),
      ],
    );
    const row = inserted[0];

    // Audit row.
    await query(
      `INSERT INTO org_audit
         (actor_email, action, target_kind, target_id, after_json, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        user.email.toLowerCase(),
        'node.create',
        'node',
        row.id,
        JSON.stringify(row),
        JSON.stringify({ parentId, kind, slug }),
      ],
    );

    // Phase 10b (2026-05-20): auto-seed the lead as the dept's Admin so a
    // freshly-created department always has at least one member. Scope:
    // kind==='department' only — teams have leads but they're labels, not
    // admin roles. Failure is non-fatal: dept creation succeeds and the
    // admin can re-trigger by saving the dept again.
    let leadSeed = null;
    if (kind === 'department' && leadEmail) {
      try {
        leadSeed = await ensureLeadIsDeptAdmin({
          nodeId: row.id,
          leadEmail,
          actorEmail: user.email,
        });
      } catch (seedErr) {
        console.warn('[org/nodes POST] lead auto-seed failed:', seedErr.message);
        leadSeed = { error: seedErr.message };
      }
    }

    return NextResponse.json({
      node: {
        id: row.id,
        parentId: row.parent_id,
        kind: row.kind,
        name: row.name,
        slug: row.slug,
        description: row.description,
        leadEmail: row.lead_email,
        color: row.color,
        icon: row.icon,
        slackChannel: row.slack_channel,
        countryCodes: row.country_codes || [],
        sortOrder: row.sort_order,
        isArchived: row.is_archived,
        config: row.config || {},
        createdAt: row.created_at,
        createdBy: row.created_by,
        updatedAt: row.updated_at,
        memberCount: leadSeed && !leadSeed.error && !leadSeed.skipped ? 1 : 0,
        vacantCount: 0,
      },
      leadSeed,
    }, { status: 201 });
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'A node with this name or slug already exists' }, { status: 409 });
    }
    console.error('[org/nodes POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

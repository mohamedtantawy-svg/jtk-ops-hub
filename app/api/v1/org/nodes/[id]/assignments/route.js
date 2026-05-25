// ── /api/v1/org/nodes/[id]/assignments (Phase 12a, 2026-05-25) ────────────
// GET  — list assignments for a node, optionally filtered by ?kind=. Returns
//        the rows + `oooEmails` so the FE can render the "Backup covering"
//        badge without a second roundtrip.
// POST — create an assignment (body: { kind, name, description?, assignees, backups, sortOrder? }).
//
// Permission: GET open to any authenticated user in the dept's scope (read
// access matches the rest of the Org tab — everyone in the org sees the
// tree). Edit requires canManageOrgNode (global admin / regional manager OR
// delegated org_node_admin grant covering this node or any ancestor).
//
// Note on shape: assignee_emails / backup_emails are normalised to
// lowercase + @deel.com on write so the FE can do case-insensitive lookups
// without re-normalising.

import { NextResponse } from 'next/server';
import { query } from '../../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import { canManageOrgNode } from '../../../../../../../src/lib/org-admin';

const VALID_KINDS = new Set(['swat_function', 'responsibility']);
const NAME_MAX = 255;
const DESCRIPTION_MAX = 2000;
const MAX_OWNERS_PER_FIELD = 24;
const MAX_ROWS_PER_NODE = 500;

function normaliseEmails(raw, label) {
  if (raw == null) return [];
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

export function rowToAssignment(r) {
  if (!r) return null;
  return {
    id: r.id,
    nodeId: r.node_id,
    kind: r.kind,
    name: r.name,
    description: r.description || '',
    assignees: r.assignee_emails || [],
    backups: r.backup_emails || [],
    sortOrder: r.sort_order ?? 0,
    isArchived: r.is_archived === true,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by || null,
    updatedBy: r.updated_by || null,
  };
}

// Resolve which assignee/backup emails are on approved leave RIGHT NOW
// (server clock, in date-only terms). Returns a lowercased Set so the
// FE can do O(1) lookups for the "Backup covering" badge. Defensive: a
// missing time_off_events table on a brand-new env returns an empty set.
async function fetchOooEmails(emails) {
  if (!emails || !emails.length) return [];
  try {
    const { rows } = await query(
      `SELECT DISTINCT LOWER(work_email) AS email
         FROM time_off_events
        WHERE LOWER(work_email) = ANY($1::text[])
          AND status = 'approved'
          AND start_date <= CURRENT_DATE
          AND end_date >= CURRENT_DATE`,
      [emails],
    );
    return rows.map(r => r.email);
  } catch (err) {
    console.warn('[org-assignments] OOO lookup failed:', err?.message);
    return [];
  }
}

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const kindFilter = searchParams.get('kind');
  if (kindFilter && !VALID_KINDS.has(kindFilter)) {
    return NextResponse.json({ error: `kind must be one of: ${Array.from(VALID_KINDS).join(', ')}` }, { status: 400 });
  }
  // include_archived defaults off so the UI doesn't have to filter
  const includeArchived = searchParams.get('include_archived') === '1';

  try {
    const params2 = [id];
    let whereExtra = '';
    if (kindFilter) {
      params2.push(kindFilter);
      whereExtra += ` AND kind = $${params2.length}`;
    }
    if (!includeArchived) {
      whereExtra += ' AND is_archived = false';
    }
    const { rows } = await query(
      `SELECT id, node_id, kind, name, description, assignee_emails, backup_emails,
              sort_order, is_archived, created_at, updated_at, created_by, updated_by
         FROM org_node_assignments
        WHERE node_id = $1${whereExtra}
        ORDER BY kind, sort_order, name`,
      params2,
    );
    const assignments = rows.map(rowToAssignment);
    const allEmails = Array.from(new Set(
      assignments.flatMap(a => [...a.assignees, ...a.backups]),
    ));
    const oooEmails = await fetchOooEmails(allEmails);
    const canEdit = await canManageOrgNode(user, id);
    return NextResponse.json({ assignments, oooEmails, canEdit });
  } catch (err) {
    console.error('[org/nodes/:id/assignments GET]', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await canManageOrgNode(user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const kind = String(body?.kind || '').trim();
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${Array.from(VALID_KINDS).join(', ')}` }, { status: 400 });
  }
  const name = String(body?.name || '').trim().slice(0, NAME_MAX);
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const description = body?.description == null ? null : String(body.description).slice(0, DESCRIPTION_MAX);

  let assignees, backups;
  try {
    assignees = normaliseEmails(body?.assignees, 'assignees');
    backups = normaliseEmails(body?.backups, 'backups');
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 400 });
  }

  // Sort order: caller may pin a value; otherwise append after the last row.
  let sortOrder = Number.isFinite(body?.sortOrder) ? Math.floor(body.sortOrder) : null;
  try {
    if (sortOrder == null) {
      const { rows: maxRows } = await query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort
           FROM org_node_assignments
          WHERE node_id = $1 AND kind = $2 AND is_archived = false`,
        [id, kind],
      );
      sortOrder = Number(maxRows[0]?.next_sort) || 0;
    }
  } catch (err) {
    console.warn('[org-assignments POST] sort_order lookup failed:', err?.message);
    sortOrder = 0;
  }

  // Defensive cap so a buggy import can't balloon a single dept's list.
  try {
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS n FROM org_node_assignments
        WHERE node_id = $1 AND kind = $2 AND is_archived = false`,
      [id, kind],
    );
    if ((countRows[0]?.n ?? 0) >= MAX_ROWS_PER_NODE) {
      return NextResponse.json({
        error: `Each department can hold at most ${MAX_ROWS_PER_NODE} active rows per kind`,
      }, { status: 409 });
    }
  } catch (err) {
    console.warn('[org-assignments POST] count check failed:', err?.message);
  }

  try {
    const { rows } = await query(
      `INSERT INTO org_node_assignments
         (node_id, kind, name, description, assignee_emails, backup_emails,
          sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id, node_id, kind, name, description, assignee_emails, backup_emails,
                 sort_order, is_archived, created_at, updated_at, created_by, updated_by`,
      [id, kind, name, description, assignees, backups, sortOrder, user.email.toLowerCase()],
    );
    const created = rowToAssignment(rows[0]);

    // Audit trail. Soft failures here don't bubble up — the assignment row
    // already exists and the user expects success.
    try {
      await query(
        `INSERT INTO org_audit (actor_email, action, target_kind, target_id, after_json, metadata)
         VALUES ($1, $2, 'assignment', $3, $4::jsonb, $5::jsonb)`,
        [
          user.email.toLowerCase(),
          'assignment.create',
          created.id,
          JSON.stringify(created),
          JSON.stringify({ nodeId: id, kind }),
        ],
      );
    } catch (err) {
      console.warn('[org-assignments POST] audit insert failed:', err?.message);
    }

    return NextResponse.json({ assignment: created }, { status: 201 });
  } catch (err) {
    console.error('[org/nodes/:id/assignments POST]', err?.message);
    if (err.code === '23503') {
      return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Server-side CRUD + access checks for the workspace_members table.
//
// All reads/writes are explicitly scoped by workspace_id at the SQL level —
// no caller can read/modify rows in another workspace without passing its id.
// HR Hub is NOT a valid workspaceId here; HR's membership is implicit (any
// @deel.com via SSO) and its admin model is HR's own is_*_admin flags.
//
// Returned rows are minimal: { email, role, added_by, added_at } — never the
// raw DB row, so caller code can't accidentally leak audit columns.

import { query } from './db';

const VALID_WORKSPACES = new Set(['command-center', 'payroll', 'gix']);
const VALID_ROLES = new Set(['member', 'admin']);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateWorkspace(workspaceId) {
  if (!VALID_WORKSPACES.has(workspaceId)) {
    const err = new Error(`Invalid workspace: ${workspaceId}`);
    err.code = 'INVALID_WORKSPACE';
    throw err;
  }
}

// ── Membership checks ─────────────────────────────────────────────────────

export async function isWorkspaceMember(workspaceId, email) {
  validateWorkspace(workspaceId);
  const e = normalizeEmail(email);
  if (!e) return false;
  const { rows } = await query(
    `SELECT 1 FROM workspace_members
      WHERE workspace_id = $1 AND LOWER(email) = $2 AND status = 'active'
      LIMIT 1`,
    [workspaceId, e],
  );
  return rows.length > 0;
}

export async function isWorkspaceAdmin(workspaceId, email) {
  validateWorkspace(workspaceId);
  const e = normalizeEmail(email);
  if (!e) return false;
  const { rows } = await query(
    `SELECT 1 FROM workspace_members
      WHERE workspace_id = $1 AND LOWER(email) = $2 AND status = 'active' AND role = 'admin'
      LIMIT 1`,
    [workspaceId, e],
  );
  return rows.length > 0;
}

// All active workspaces a given email is a member of. Used by the frontend
// to determine which workspaces to show in the picker / which is reachable.
export async function getMembershipsForEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return [];
  const { rows } = await query(
    `SELECT workspace_id, role
       FROM workspace_members
      WHERE LOWER(email) = $1 AND status = 'active'`,
    [e],
  );
  return rows.map(r => ({ workspaceId: r.workspace_id, role: r.role }));
}

// ── Member list (admin UI) ────────────────────────────────────────────────

export async function listMembers(workspaceId, { search = '', limit = 50, offset = 0 } = {}) {
  validateWorkspace(workspaceId);
  const params = [workspaceId];
  const conditions = [`workspace_id = $1`, `status = 'active'`];
  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`LOWER(email) LIKE $${params.length}`);
  }
  const where = conditions.join(' AND ');

  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  params.push(cap, off);

  const listSql = `
    SELECT email, role, added_by, added_at
      FROM workspace_members
     WHERE ${where}
     ORDER BY email ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const countSql = `SELECT COUNT(*)::int AS total FROM workspace_members WHERE ${where}`;
  const countParams = params.slice(0, params.length - 2);

  const [list, count] = await Promise.all([
    query(listSql, params),
    query(countSql, countParams),
  ]);
  return {
    members: list.rows.map(r => ({
      email: r.email,
      role: r.role,
      addedBy: r.added_by || null,
      addedAt: r.added_at,
    })),
    total: count.rows[0]?.total || 0,
    limit: cap,
    offset: off,
  };
}

// ── Mutations ─────────────────────────────────────────────────────────────

export async function addMember(workspaceId, email, role, addedBy) {
  validateWorkspace(workspaceId);
  const e = normalizeEmail(email);
  if (!e) {
    const err = new Error('Email required'); err.code = 'BAD_INPUT'; throw err;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    const err = new Error('Invalid email format'); err.code = 'BAD_INPUT'; throw err;
  }
  const r = VALID_ROLES.has(role) ? role : 'member';
  const by = normalizeEmail(addedBy) || null;

  // Phase 11g (2026-05-20): stamp the NEW member's own dept (not the
  // adder's). Resolves via the recursive CTE to their top-level dept.
  // Null is permitted while the new member's org placement is being set up.
  const { getTopLevelDeptForMember } = await import('./dept-scope');
  const subjectDept = await getTopLevelDeptForMember(e);
  const subjectDeptId = subjectDept?.deptId || null;

  const { rows } = await query(
    `INSERT INTO workspace_members (workspace_id, email, role, added_by, org_node_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, LOWER(email))
       WHERE status = 'active'
       DO NOTHING
     RETURNING email, role, added_by, added_at`,
    [workspaceId, e, r, by, subjectDeptId],
  );
  if (!rows.length) {
    // Either already a member, or had a 'removed' row blocking. Try reviving
    // a removed row, otherwise return existing.
    const revive = await query(
      `UPDATE workspace_members
          SET status = 'active', added_by = $3, added_at = NOW(),
              removed_by = NULL, removed_at = NULL, role = $4
        WHERE workspace_id = $1 AND LOWER(email) = $2 AND status = 'removed'
        RETURNING email, role, added_by, added_at`,
      [workspaceId, e, by, r],
    );
    if (revive.rows.length) return { ...revive.rows[0], revived: true };
    // Already active — return as-is, idempotent.
    const existing = await query(
      `SELECT email, role, added_by, added_at FROM workspace_members
        WHERE workspace_id = $1 AND LOWER(email) = $2 AND status = 'active'`,
      [workspaceId, e],
    );
    return { ...(existing.rows[0] || { email: e, role: r }), existed: true };
  }
  return rows[0];
}

export async function updateRole(workspaceId, email, role) {
  validateWorkspace(workspaceId);
  const e = normalizeEmail(email);
  if (!VALID_ROLES.has(role)) {
    const err = new Error('Invalid role'); err.code = 'BAD_INPUT'; throw err;
  }
  const { rows } = await query(
    `UPDATE workspace_members
        SET role = $3
      WHERE workspace_id = $1 AND LOWER(email) = $2 AND status = 'active'
      RETURNING email, role, added_by, added_at`,
    [workspaceId, e, role],
  );
  return rows[0] || null;
}

export async function removeMember(workspaceId, email, removedBy) {
  validateWorkspace(workspaceId);
  const e = normalizeEmail(email);
  const by = normalizeEmail(removedBy) || null;
  const { rows } = await query(
    `UPDATE workspace_members
        SET status = 'removed', removed_by = $3, removed_at = NOW()
      WHERE workspace_id = $1 AND LOWER(email) = $2 AND status = 'active'
      RETURNING email`,
    [workspaceId, e, by],
  );
  return rows.length > 0;
}

// Count admins in a workspace — used to prevent removing the last admin
// (which would leave the workspace orphaned with no one able to manage it).
export async function countAdmins(workspaceId) {
  validateWorkspace(workspaceId);
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM workspace_members
      WHERE workspace_id = $1 AND status = 'active' AND role = 'admin'`,
    [workspaceId],
  );
  return rows[0]?.c || 0;
}

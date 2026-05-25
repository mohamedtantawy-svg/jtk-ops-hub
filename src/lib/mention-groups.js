// ── Mention groups ─────────────────────────────────────────────────────────
// Slack-style @-handles that expand to a list of members. Anyone
// authenticated can create + edit. The mention parser in every comment
// surface (HR Hub, Leaders Alerts, Feedback) consults `loadGroupsByHandle()`
// once per POST and passes the resulting Map to `parseMentions(body, map)`;
// any token whose lowercased value matches a group handle resolves to the
// group's member emails (which then flow through the existing
// addFollower + writeNotifications fan-out). User and group resolution
// share the same token shape (`@hrxtools`, `@latam-team`) — the parser
// tries group first because handles are deliberately non-overlapping with
// email localparts (admins are advised to pick handles users won't type).
//
// The shape `loadGroupsByHandle()` returns is `Map<lowercasedHandle,
// string[]>` where each value is the lowercased member-email list. Keep
// it cheap: the table is small (org-wide handles, not per-row state) and
// loading the whole thing per comment POST is trivial.
import { query } from './db';

const MAX_HANDLE_LEN = 80;
const MAX_NAME_LEN   = 200;
const MAX_DESC_LEN   = 2000;
const MAX_MEMBERS    = 200;

// Handles must be lowercased, start with a letter, and contain only
// letters / digits / `.` / `-` / `_`. Same charset the @ token regex
// accepts so a handle is always typeable.
const HANDLE_RX = /^[a-z][a-z0-9._-]{0,79}$/;

export function isValidHandle(s) {
  return typeof s === 'string' && HANDLE_RX.test(s);
}

function cleanEmails(arr) {
  if (!Array.isArray(arr)) return [];
  const out = new Set();
  for (const raw of arr) {
    if (typeof raw !== 'string') continue;
    const e = raw.trim().toLowerCase();
    if (e && e.includes('@')) out.add(e);
  }
  return Array.from(out).slice(0, MAX_MEMBERS);
}

function clean(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return max && t.length > max ? t.slice(0, max) : t;
}

/**
 * Load every group's handle + member-email list for ONE dept. Returns
 * `Map<handle, string[]>` for cheap O(1) lookup inside `parseMentions`.
 * Empty Map on DB error so a comment POST never fails because the group
 * subsystem misbehaves.
 *
 * Phase 12b (2026-05-25): all callers pass `{ deptId }` so a comment in
 * dept A never expands to a handle owned by dept B. Falls back to an
 * empty Map if deptId is missing — never returns cross-dept groups
 * silently.
 */
export async function loadGroupsByHandle({ deptId } = {}) {
  if (!deptId) return new Map();
  try {
    const { rows } = await query(
      `SELECT g.handle, COALESCE(array_agg(m.member_email) FILTER (WHERE m.member_email IS NOT NULL), '{}') AS members
         FROM mention_group g
         LEFT JOIN mention_group_member m ON m.group_id = g.id
        WHERE g.org_node_id = $1
        GROUP BY g.handle`,
      [deptId],
    );
    const map = new Map();
    for (const r of rows) {
      map.set(String(r.handle).toLowerCase(), (r.members || []).map(e => String(e).toLowerCase()));
    }
    return map;
  } catch (err) {
    console.warn('[mention-groups] loadGroupsByHandle failed:', err?.message);
    return new Map();
  }
}

/**
 * List every group OWNED by the given dept. Pass `{ deptId: null }` to
 * intentionally return nothing (e.g. when dept resolution failed and the
 * caller wants to short-circuit). The modal + composer typeahead both
 * scope by current dept.
 */
export async function listGroups({ deptId } = {}) {
  if (!deptId) return [];
  const { rows } = await query(
    `SELECT g.id, g.handle, g.name, g.description, g.org_node_id,
            g.created_by_email, g.created_by_name,
            g.created_at, g.updated_at,
            COALESCE(array_agg(m.member_email ORDER BY m.member_email)
                     FILTER (WHERE m.member_email IS NOT NULL), '{}') AS members
       FROM mention_group g
       LEFT JOIN mention_group_member m ON m.group_id = g.id
      WHERE g.org_node_id = $1
      GROUP BY g.id
      ORDER BY g.handle ASC`,
    [deptId],
  );
  return rows.map(r => ({
    id: r.id,
    handle: r.handle,
    name: r.name || '',
    description: r.description || '',
    orgNodeId: r.org_node_id,
    createdByEmail: r.created_by_email,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    members: r.members || [],
  }));
}

/**
 * Fetch a single group. When `deptId` is provided, returns null if the
 * group belongs to a different dept (read-isolated). The mention-groups
 * [id] route passes the caller's current dept so a tampered URL can't
 * reach across tenants.
 */
export async function getGroupById(id, { deptId } = {}) {
  const { rows } = await query(
    `SELECT g.id, g.handle, g.name, g.description, g.org_node_id,
            g.created_by_email, g.created_by_name,
            g.created_at, g.updated_at,
            COALESCE(array_agg(m.member_email ORDER BY m.member_email)
                     FILTER (WHERE m.member_email IS NOT NULL), '{}') AS members
       FROM mention_group g
       LEFT JOIN mention_group_member m ON m.group_id = g.id
      WHERE g.id = $1
      GROUP BY g.id`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  if (deptId && r.org_node_id && String(r.org_node_id) !== String(deptId)) return null;
  return {
    id: r.id,
    handle: r.handle,
    name: r.name || '',
    description: r.description || '',
    orgNodeId: r.org_node_id,
    createdByEmail: r.created_by_email,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    members: r.members || [],
  };
}

/**
 * Create a new group with its initial member set. Throws on duplicate
 * handle (caller should map to HTTP 409). Members are deduplicated +
 * lowercased; an empty list is allowed (the group can be filled later
 * via PATCH).
 */
export async function createGroup({ handle, name, description, members, creatorEmail, creatorName, deptId }) {
  if (!deptId) {
    throw Object.assign(new Error('A current department is required to create a group'), { status: 400 });
  }
  const h = clean(handle, MAX_HANDLE_LEN)?.toLowerCase();
  if (!isValidHandle(h)) {
    throw Object.assign(new Error('Handle must start with a letter and use only a-z, 0-9, dot, hyphen, or underscore'), { status: 400 });
  }
  const memberEmails = cleanEmails(members);
  // Per-dept handle uniqueness — two depts can each own @leads as
  // independent fan-outs (Phase 12b). ON CONFLICT targets the partial
  // unique index uniq_mention_group_dept_handle.
  const ins = await query(
    `INSERT INTO mention_group (handle, name, description, created_by_email, created_by_name, org_node_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (org_node_id, LOWER(handle)) DO NOTHING
     RETURNING id`,
    [h, clean(name, MAX_NAME_LEN), clean(description, MAX_DESC_LEN), creatorEmail, creatorName || null, deptId],
  );
  if (ins.rowCount === 0) {
    throw Object.assign(new Error(`Handle "${h}" is already taken in this department`), { status: 409 });
  }
  const id = ins.rows[0].id;
  for (const email of memberEmails) {
    await query(
      `INSERT INTO mention_group_member (group_id, member_email) VALUES ($1, $2)
       ON CONFLICT (group_id, member_email) DO NOTHING`,
      [id, email],
    );
  }
  return getGroupById(id, { deptId });
}

/**
 * Update a group's name/description/members. Handle is immutable —
 * changing it would silently invalidate every comment that already
 * tagged the old handle. Members are replaced wholesale (set semantics):
 * remove rows not in the new list, insert new ones. Idempotent.
 */
export async function updateGroup(id, { name, description, members }, { deptId } = {}) {
  const existing = await getGroupById(id, { deptId });
  if (!existing) {
    throw Object.assign(new Error('Group not found'), { status: 404 });
  }
  const updates = [];
  const values = [];
  let p = 1;
  if (name !== undefined) { updates.push(`name = $${p++}`); values.push(clean(name, MAX_NAME_LEN)); }
  if (description !== undefined) { updates.push(`description = $${p++}`); values.push(clean(description, MAX_DESC_LEN)); }
  if (updates.length > 0) {
    updates.push(`updated_at = NOW()`);
    values.push(id);
    await query(
      `UPDATE mention_group SET ${updates.join(', ')} WHERE id = $${p}`,
      values,
    );
  }
  if (Array.isArray(members)) {
    const next = new Set(cleanEmails(members));
    const prev = new Set((existing.members || []).map(e => e.toLowerCase()));
    const toRemove = [...prev].filter(e => !next.has(e));
    const toAdd    = [...next].filter(e => !prev.has(e));
    for (const e of toRemove) {
      await query(
        `DELETE FROM mention_group_member WHERE group_id = $1 AND LOWER(member_email) = $2`,
        [id, e],
      );
    }
    for (const e of toAdd) {
      await query(
        `INSERT INTO mention_group_member (group_id, member_email) VALUES ($1, $2)
         ON CONFLICT (group_id, member_email) DO NOTHING`,
        [id, e],
      );
    }
  }
  return getGroupById(id, { deptId });
}

export async function deleteGroup(id, { deptId } = {}) {
  // Dept-scoped check so a tampered URL can't drop another tenant's group.
  // Admins are NOT escalated here — even an admin acting outside their
  // current dept context shouldn't reach across; super-admins use the
  // dept-picker which feeds the same getCurrentDeptId() resolver.
  const existing = await getGroupById(id, { deptId });
  if (!existing) return false;
  const result = await query(
    `DELETE FROM mention_group WHERE id = $1`,
    [id],
  );
  return result.rowCount > 0;
}

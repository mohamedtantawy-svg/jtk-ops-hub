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
 * Load every group's handle + member-email list. Returns
 * `Map<handle, string[]>` for cheap O(1) lookup inside `parseMentions`.
 * Empty Map on DB error so a comment POST never fails because the group
 * subsystem misbehaves.
 */
export async function loadGroupsByHandle() {
  try {
    const { rows } = await query(
      `SELECT g.handle, COALESCE(array_agg(m.member_email) FILTER (WHERE m.member_email IS NOT NULL), '{}') AS members
         FROM mention_group g
         LEFT JOIN mention_group_member m ON m.group_id = g.id
        GROUP BY g.handle`,
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

export async function listGroups() {
  const { rows } = await query(
    `SELECT g.id, g.handle, g.name, g.description,
            g.created_by_email, g.created_by_name,
            g.created_at, g.updated_at,
            COALESCE(array_agg(m.member_email ORDER BY m.member_email)
                     FILTER (WHERE m.member_email IS NOT NULL), '{}') AS members
       FROM mention_group g
       LEFT JOIN mention_group_member m ON m.group_id = g.id
      GROUP BY g.id
      ORDER BY g.handle ASC`,
  );
  return rows.map(r => ({
    id: r.id,
    handle: r.handle,
    name: r.name || '',
    description: r.description || '',
    createdByEmail: r.created_by_email,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    members: r.members || [],
  }));
}

export async function getGroupById(id) {
  const { rows } = await query(
    `SELECT g.id, g.handle, g.name, g.description,
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
  return {
    id: r.id,
    handle: r.handle,
    name: r.name || '',
    description: r.description || '',
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
export async function createGroup({ handle, name, description, members, creatorEmail, creatorName }) {
  const h = clean(handle, MAX_HANDLE_LEN)?.toLowerCase();
  if (!isValidHandle(h)) {
    throw Object.assign(new Error('Handle must start with a letter and use only a-z, 0-9, dot, hyphen, or underscore'), { status: 400 });
  }
  const memberEmails = cleanEmails(members);
  const ins = await query(
    `INSERT INTO mention_group (handle, name, description, created_by_email, created_by_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (LOWER(handle)) DO NOTHING
     RETURNING id`,
    [h, clean(name, MAX_NAME_LEN), clean(description, MAX_DESC_LEN), creatorEmail, creatorName || null],
  );
  if (ins.rowCount === 0) {
    throw Object.assign(new Error(`Handle "${h}" is already taken`), { status: 409 });
  }
  const id = ins.rows[0].id;
  for (const email of memberEmails) {
    await query(
      `INSERT INTO mention_group_member (group_id, member_email) VALUES ($1, $2)
       ON CONFLICT (group_id, member_email) DO NOTHING`,
      [id, email],
    );
  }
  return getGroupById(id);
}

/**
 * Update a group's name/description/members. Handle is immutable —
 * changing it would silently invalidate every comment that already
 * tagged the old handle. Members are replaced wholesale (set semantics):
 * remove rows not in the new list, insert new ones. Idempotent.
 */
export async function updateGroup(id, { name, description, members }) {
  const existing = await getGroupById(id);
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
  return getGroupById(id);
}

export async function deleteGroup(id) {
  const result = await query(
    `DELETE FROM mention_group WHERE id = $1`,
    [id],
  );
  return result.rowCount > 0;
}

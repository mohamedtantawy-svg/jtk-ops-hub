// ── Single team-member override endpoint ───────────────────────────────────
// PATCH  /api/v1/team-members/:email — upsert override fields (allocation edit)
// DELETE /api/v1/team-members/:email — soft-delete (baseline) or hard-delete (is_new)
//
// Email is URL-decoded by Next.js's dynamic segment handler; we lowercase
// before any DB access so `MOHAMED@Deel.com` and `mohamed@deel.com` match.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { TEAM_MEMBERS } from '../../../../../src/data/members';
import { invalidateRosterCache, ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import { canManageRoster, bustAccessAdminCache } from '../../../../../src/lib/access-admin';

const VALID_ACCESS = ['admin', 'regional_manager', 'team_lead', 'agent'];
const VALID_SERVICES = ['EOR', 'LifeCycle', 'New Services', 'All'];
const VALID_TEAMS = ['All', 'EMEA', 'APAC', 'LATAM', 'NAM', 'LATAM + NAM'];

// Resolve a subject email from URL params. Next.js 16 makes params a promise.
async function resolveEmail(params) {
  const { email } = await params;
  return decodeURIComponent(email || '').trim().toLowerCase();
}

function hasBaseline(email) {
  return TEAM_MEMBERS.some(m => m.email.toLowerCase() === email);
}

export async function PATCH(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await canManageRoster(user))) {
      return NextResponse.json({ error: 'Only admins, regional managers, or designated Access Admins can edit allocations' }, { status: 403 });
    }

    const email = await resolveEmail(params);
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });

    const body = await req.json();

    // Whitelist the fields we accept. Any column not in this set is ignored.
    // camelCase (from client) → snake_case (for SQL).
    const FIELD_MAP = {
      name: 'name',
      initials: 'initials',
      title: 'title',
      access: 'access',
      managerEmail: 'manager_email',
      team: 'team',
      region: 'region',
      service: 'service',
      country: 'country',
      avatarUrl: 'avatar_url',
      startDate: 'start_date',
      onLeave: 'on_leave',
      // Per-user permission grants (Director-managed). Booleans, no enum.
      isAnnouncementsAdmin: 'is_announcements_admin',
      isAccessAdmin: 'is_access_admin',
      // Phase 3 (Org Tab): allocation now flows through org_node_id. Legacy
      // `team` stays in the map for backwards-compat through Phase 5; Phase
      // 6 drops it once every consumer reads from the new structure.
      orgNodeId: 'org_node_id',
    };

    // Enum guards
    if (body.access !== undefined && body.access !== null && !VALID_ACCESS.includes(body.access)) {
      return NextResponse.json({ error: `Invalid access. Must be one of: ${VALID_ACCESS.join(', ')}` }, { status: 400 });
    }
    if (body.service !== undefined && body.service !== null && !VALID_SERVICES.includes(body.service)) {
      return NextResponse.json({ error: `Invalid service. Must be one of: ${VALID_SERVICES.join(', ')}` }, { status: 400 });
    }
    if (body.team !== undefined && body.team !== null && !VALID_TEAMS.includes(body.team)) {
      return NextResponse.json({ error: `Invalid team. Must be one of: ${VALID_TEAMS.join(', ')}` }, { status: 400 });
    }

    const updates = [];
    const values = [];
    for (const [clientKey, dbCol] of Object.entries(FIELD_MAP)) {
      if (Object.prototype.hasOwnProperty.call(body, clientKey)) {
        let val = body[clientKey];
        if (typeof val === 'string') val = val.trim();
        if (val === '') val = null;
        if (clientKey === 'managerEmail' && typeof val === 'string') val = val.toLowerCase();
        // Coerce boolean permission flags so JSON `true`/`false` strings or
        // numbers become real booleans for the JSONB write.
        if (clientKey === 'isAnnouncementsAdmin' || clientKey === 'isAccessAdmin') val = !!val;
        updates.push(dbCol);
        values.push(val);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Upsert: row may not exist yet for baseline users (first edit creates it).
    // ON CONFLICT DO UPDATE covers both new-row and existing-row paths.
    const isBaseline = hasBaseline(email);
    const insertCols = ['email', ...updates, 'is_new', 'is_deleted'];
    const insertVals = [email, ...values, !isBaseline, false];
    const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = updates.map((c, i) => `${c} = EXCLUDED.${c}`).join(', ');

    const sql = `
      INSERT INTO team_member_overrides (${insertCols.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (email) DO UPDATE
      SET ${updateSet}, updated_at = NOW()
      RETURNING email, name, initials, title, access, manager_email, team, region,
                service, country, avatar_url, start_date, is_new, is_deleted,
                on_leave, is_announcements_admin,
                is_access_admin,
                org_node_id,
                created_at, updated_at
    `;

    const { rows } = await query(sql, insertVals);
    const row = rows[0];

    // Fetch live activity from member_logins (the canonical store) so the
    // PATCH response shows the same lastSeenAt the table renders. Empty
    // result on a fresh user → null fields, displayed as "Never seen".
    let loginRow = null;
    try {
      const { rows: loginRows } = await query(
        `SELECT last_seen_at, last_login_at, login_count FROM member_logins WHERE email = $1`,
        [email],
      );
      loginRow = loginRows[0] || null;
    } catch (loginErr) {
      console.warn('[team-members PATCH] member_logins lookup failed:', loginErr.message);
    }

    // Keep the members table in sync with edited allocation. Auth + /me +
    // permissions all read from `members`, so a stale row there would cause
    // the Home view to mis-scope even if the override row is correct.
    // Only patch fields we can confidently map (auth-relevant ones).
    try {
      const memPatch = [];
      const memVals = [];
      const memMap = {
        name: 'name', initials: 'initials', access: 'role', team: 'team',
        region: 'region', country: 'country', avatarUrl: 'avatar_url',
      };
      for (const [clientKey, dbCol] of Object.entries(memMap)) {
        if (Object.prototype.hasOwnProperty.call(body, clientKey)) {
          let val = body[clientKey];
          if (typeof val === 'string') val = val.trim();
          if (val === '') val = null;
          memPatch.push(`${dbCol} = $${memPatch.length + 2}`);
          memVals.push(val);
        }
      }
      if (memPatch.length > 0) {
        memPatch.push('updated_at = NOW()');
        await query(
          `UPDATE members SET ${memPatch.join(', ')} WHERE email = $1`,
          [email, ...memVals]
        );
      }
    } catch (memErr) {
      console.warn('[team-members PATCH] members sync failed:', memErr.message);
    }

    // Force a fresh hydration so the very next scoped API call reflects
    // this allocation / access change (no waiting on the 5s TTL).
    invalidateRosterCache();
    await ensureRosterHydrated({ force: true });

    // Also bust the announcements-admin per-user cache so the new flag
    // value is honoured by the next announcement-route hit (otherwise
    // there's up to 30s of stale-flag lag after a grant/revoke).
    if (Object.prototype.hasOwnProperty.call(body, 'isAnnouncementsAdmin')) {
      try {
        const { bustAnnouncementsAdminCache } = await import('../../../../../src/lib/announcements-admin');
        bustAnnouncementsAdminCache(email);
      } catch {}
    }
    // Same for access-admin: a grant/revoke needs to take effect on the
    // very next /team-members write rather than waiting for the 30s TTL.
    if (Object.prototype.hasOwnProperty.call(body, 'isAccessAdmin')) {
      bustAccessAdminCache(email);
    }

    return NextResponse.json({
      email: row.email,
      name: row.name,
      initials: row.initials,
      title: row.title,
      access: row.access,
      managerEmail: row.manager_email,
      team: row.team,
      region: row.region,
      service: row.service,
      country: row.country,
      avatarUrl: row.avatar_url,
      startDate: row.start_date ? (typeof row.start_date === 'string' ? row.start_date : row.start_date.toISOString().slice(0, 10)) : null,
      isNew: row.is_new,
      isDeleted: row.is_deleted,
      onLeave: row.on_leave,
      // Login activity comes from member_logins (canonical), not the
      // legacy team_member_overrides columns.
      lastSeenAt: loginRow?.last_seen_at
        ? (typeof loginRow.last_seen_at === 'string' ? loginRow.last_seen_at : loginRow.last_seen_at.toISOString())
        : null,
      lastLoginAt: loginRow?.last_login_at
        ? (typeof loginRow.last_login_at === 'string' ? loginRow.last_login_at : loginRow.last_login_at.toISOString())
        : null,
      loginCount: loginRow?.login_count || 0,
      isAnnouncementsAdmin: row.is_announcements_admin === true,
      isAccessAdmin: row.is_access_admin === true,
      // Phase 3 (Org Tab): expose the org node id so the FE applies the
      // updated allocation without re-fetching the full roster.
      orgNodeId: row.org_node_id || null,
    });
  } catch (err) {
    console.error('[team-members PATCH]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await canManageRoster(user))) {
      return NextResponse.json({ error: 'Only admins, regional managers, or designated Access Admins can remove members' }, { status: 403 });
    }

    const email = await resolveEmail(params);
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });

    const isBaseline = hasBaseline(email);

    if (isBaseline) {
      // Soft-delete: persist is_deleted=true override row (or update existing)
      await query(
        `INSERT INTO team_member_overrides (email, is_deleted)
         VALUES ($1, true)
         ON CONFLICT (email) DO UPDATE
         SET is_deleted = true, updated_at = NOW()`,
        [email]
      );
      // Mirror to members: mark inactive so auth blocks and /me treats as gone.
      try {
        await query('UPDATE members SET is_active = false, updated_at = NOW() WHERE email = $1', [email]);
      } catch (memErr) {
        console.warn('[team-members DELETE] members deactivate failed:', memErr.message);
      }
      invalidateRosterCache();
      await ensureRosterHydrated({ force: true });
      return NextResponse.json({ email, isDeleted: true, mode: 'soft' });
    }

    // Not in baseline → hard delete the override row (it only existed to
    // represent a net-new member; removing it is the true remove).
    await query('DELETE FROM team_member_overrides WHERE email = $1', [email]);
    // And remove the members row seeded when the override was created.
    try {
      await query('DELETE FROM members WHERE email = $1', [email]);
    } catch (memErr) {
      console.warn('[team-members DELETE] members purge failed:', memErr.message);
    }
    invalidateRosterCache();
    await ensureRosterHydrated({ force: true });
    return NextResponse.json({ email, isDeleted: true, mode: 'hard' });
  } catch (err) {
    console.error('[team-members DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── Team-members roster endpoint (baseline × overrides merge) ───────────────
// GET  /api/v1/team-members          — returns the merged, authoritative list
// POST /api/v1/team-members          — add a brand-new team member
//
// Unlike /api/v1/members (which is a thin CRUD over the `members` auth table),
// this endpoint is backed by team_member_overrides, layered on top of the
// static TEAM_MEMBERS baseline. Every mutation persists to the DB so the
// Team tab survives refreshes and pod restarts with zero data loss.
//
// Auth: any authenticated @deel.com user can read (~104-person internal
// tool). Writes require admin or regional_manager — see POST below.

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { mergeTeamMembers } from '../../../../src/lib/team-members-merge';
import { invalidateRosterCache, ensureRosterHydrated } from '../../../../src/lib/roster-server';
import { canManageRoster } from '../../../../src/lib/access-admin';

const VALID_ACCESS = ['admin', 'regional_manager', 'team_lead', 'agent'];
const VALID_SERVICES = ['EOR', 'LifeCycle', 'New Services', 'All'];
// Phase 6 (2026-05-20): the team allow-list is now layered. The hard-coded
// list below stays as the legacy fallback (matches the regions used by
// pre-Org-tab callers); on top of it we accept any active `org_nodes.name`
// so the new Edit Allocation drawer's cascade picker can write a team
// name that doesn't exist in the old enum without rejection. Validation
// remains strict — strings outside the union still 400.
const LEGACY_VALID_TEAMS = ['All', 'EMEA', 'APAC', 'LATAM', 'NAM', 'LATAM + NAM'];
let _orgTeamNamesCache = { names: new Set(), ts: 0 };
const ORG_TEAMS_TTL_MS = 60_000;
async function getValidTeamNames() {
  const now = Date.now();
  if (_orgTeamNamesCache.ts && now - _orgTeamNamesCache.ts < ORG_TEAMS_TTL_MS) {
    return _orgTeamNamesCache.names;
  }
  const set = new Set(LEGACY_VALID_TEAMS);
  try {
    const { rows } = await query(`SELECT name FROM org_nodes WHERE is_archived = false`);
    for (const r of rows) if (r?.name) set.add(r.name);
  } catch {
    // DB unreachable — fall back to the legacy enum so writes don't fail
    // closed during an outage.
  }
  _orgTeamNamesCache = { names: set, ts: now };
  return set;
}
// Kept for compat with any external imports that still reference the
// constant. New code should call getValidTeamNames().
const VALID_TEAMS = LEGACY_VALID_TEAMS;

export async function GET(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [overridesRes, countriesRes, loginsRes, orgNodesRes] = await Promise.all([
      query(
        `SELECT email, name, initials, title, access, manager_email, team, region,
                service, country, avatar_url, start_date, is_new, is_deleted,
                on_leave, is_announcements_admin,
                is_access_admin,
                org_node_id,
                created_at, updated_at
           FROM team_member_overrides`,
      ),
      query(
        `SELECT email, country_code FROM team_member_countries ORDER BY country_code`,
      ).catch(err => {
        // Table won't exist on a brand-new env until the migration runs;
        // empty list is the safe default so the rest of the response still
        // serves.
        console.warn('[team-members GET] countries query failed:', err?.message);
        return { rows: [] };
      }),
      // member_logins is the canonical source of last_seen_at / last_login_at
      // / login_count. Pulled separately so the merge can attach activity to
      // EVERY merged member — including baseline users without an override
      // row. Empty result on a brand-new env where the table or backfill
      // hasn't run yet means every member shows "Never seen" until first
      // heartbeat / login.
      query(
        `SELECT email, last_seen_at, last_login_at, login_count FROM member_logins`,
      ).catch(err => {
        console.warn('[team-members GET] member_logins query failed:', err?.message);
        return { rows: [] };
      }),
      // org_nodes powers the per-member `department` derivation in
      // mergeTeamMembers (parent_id walk → top-level dept name). Without
      // this, Access Control's Department field falls back to the
      // hardcoded literal and never reflects real placement.
      query(
        `SELECT id, parent_id, kind, name FROM org_nodes WHERE is_archived = false`,
      ).catch(err => {
        console.warn('[team-members GET] org_nodes query failed:', err?.message);
        return { rows: [] };
      }),
    ]);

    const merged = mergeTeamMembers(overridesRes.rows, loginsRes.rows, orgNodesRes.rows);

    // Group countries by lowercase email so the UI can render every member
    // with their owned set inline. Junction rows that don't match a current
    // member (e.g. a soft-deleted person) are simply not surfaced.
    const byEmail = new Map();
    for (const r of countriesRes.rows) {
      const e = (r.email || '').toLowerCase();
      if (!e) continue;
      if (!byEmail.has(e)) byEmail.set(e, []);
      byEmail.get(e).push((r.country_code || '').toUpperCase());
    }
    const enriched = merged.map(m => ({
      ...m,
      countries: byEmail.get((m.email || '').toLowerCase()) || [],
    }));

    return NextResponse.json({ items: enriched, total: enriched.length });
  } catch (err) {
    console.error('[team-members GET]', err.message);
    // If DB is down, fall back to the baseline so the UI still renders
    // (read-only) rather than showing an empty team.
    const fallback = mergeTeamMembers([]);
    return NextResponse.json({ items: fallback, total: fallback.length, degraded: true });
  }
}

export async function POST(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await canManageRoster(user))) {
      return NextResponse.json({ error: 'Only admins, regional managers, or designated Access Admins can add members' }, { status: 403 });
    }

    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();

    if (!email || !name) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }
    if (!email.includes('@') || !email.endsWith('@deel.com')) {
      return NextResponse.json({ error: 'Email must be a valid @deel.com address' }, { status: 400 });
    }
    if (name.length > 255) {
      return NextResponse.json({ error: 'Name must be 255 characters or less' }, { status: 400 });
    }

    const access = body.access || 'agent';
    const service = body.service || 'EOR';
    const team = body.team || null;
    const region = body.region || body.team || null;
    const managerEmail = body.managerEmail ? String(body.managerEmail).trim().toLowerCase() : null;
    const country = body.country ? String(body.country).trim() : null;
    const title = body.title || 'HR Experience Specialist';
    // Phase 3 (Org Tab): new members can land directly on an org node so
    // the Org-tab "Add member" flow doesn't require a second PATCH. UUID
    // validation is loose — the FK will reject a non-existent node.
    const orgNodeId = body.orgNodeId && /^[0-9a-fA-F-]{36}$/.test(String(body.orgNodeId))
      ? String(body.orgNodeId)
      : null;

    if (!VALID_ACCESS.includes(access)) {
      return NextResponse.json({ error: `Invalid access. Must be one of: ${VALID_ACCESS.join(', ')}` }, { status: 400 });
    }
    if (service && !VALID_SERVICES.includes(service)) {
      return NextResponse.json({ error: `Invalid service. Must be one of: ${VALID_SERVICES.join(', ')}` }, { status: 400 });
    }
    if (team) {
      const validTeams = await getValidTeamNames();
      if (!validTeams.has(team)) {
        return NextResponse.json({
          error: `Invalid team "${team}". Must match a legacy region (${LEGACY_VALID_TEAMS.join(', ')}) or an existing org_nodes.name.`,
        }, { status: 400 });
      }
    }

    // Reject duplicates: only fully-populated, active override rows are
    // genuine duplicates. Shell rows (login-only stubs from the auth-flow
    // dual-write — name/access/manager all NULL) and soft-deleted rows
    // should be PROMOTED / UNDELETED by this POST instead of rejected.
    // Otherwise admins hit a dead-end: the row exists but the Team UI
    // can't see it (merge filters !is_new and is_deleted), so the user
    // can neither edit nor re-add the member.
    //
    // Mohamed Tantawy 2026-05-28 — baseline-only membership is NOT a
    // genuine duplicate either. Previously this branch ran:
    //   `if (TEAM_MEMBERS.find(email)) return 409 "Use edit-allocation"`
    // which blocked the Org-tab "Add member" flow whenever the email
    // existed in the static baseline roster (`src/data/members.js`).
    // Repro: delete a baseline member from Settings (soft-delete sets
    // is_deleted=true on the override), then re-add via Org tab → the
    // baseline match fired BEFORE the override check, so the soft-
    // delete promotion path never ran and the user was permanently
    // locked out of re-adding the member.
    // Fix: drop the standalone baseline reject. The UPSERT below
    // creates an override on top of the baseline (which is the
    // correct mental model — the baseline is read-only static data
    // and the override is the source of truth at runtime), so the
    // Org-tab "Add member" flow now works for baseline members the
    // same as for net-new ones.
    const existingRes = await query(
      `SELECT email, name, access, manager_email, is_deleted
         FROM team_member_overrides WHERE email = $1`,
      [email]
    );
    const existing = existingRes.rows[0];
    if (existing) {
      const isShell = !existing.name && !existing.access && !existing.manager_email;
      const isSoftDeleted = existing.is_deleted === true;
      if (!isShell && !isSoftDeleted) {
        return NextResponse.json({ error: 'A team member override already exists for that email.' }, { status: 409 });
      }
      // Otherwise fall through to the UPSERT below — promote / undelete.
    }

    const initials = name.split(/\s+/).filter(Boolean).map(w => w[0] || '').join('').slice(0, 4).toUpperCase();
    const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40`;
    const startDate = new Date().toISOString().slice(0, 10);

    // ON CONFLICT promotes a shell row or undeletes a soft-deleted one.
    // is_new is reset to true so the merge surface picks it up; is_deleted
    // and on_leave are reset to false so a re-added member doesn't inherit
    // a stale soft-delete state.
    await query(
      `INSERT INTO team_member_overrides
         (email, name, initials, title, access, manager_email, team, region,
          service, country, avatar_url, start_date, is_new, is_deleted, on_leave,
          org_node_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,false,false,$13)
       ON CONFLICT (email) DO UPDATE
       SET name          = EXCLUDED.name,
           initials      = EXCLUDED.initials,
           title         = EXCLUDED.title,
           access        = EXCLUDED.access,
           manager_email = EXCLUDED.manager_email,
           team          = EXCLUDED.team,
           region        = EXCLUDED.region,
           service       = EXCLUDED.service,
           country       = EXCLUDED.country,
           avatar_url    = EXCLUDED.avatar_url,
           start_date    = EXCLUDED.start_date,
           is_new        = true,
           is_deleted    = false,
           on_leave      = false,
           org_node_id   = COALESCE(EXCLUDED.org_node_id, team_member_overrides.org_node_id),
           updated_at    = NOW()`,
      [email, name, initials, title, access, managerEmail, team, region, service, country, avatarUrl, startDate, orgNodeId]
    );

    // Also seed a members row so auth (findMemberByEmail), /me, and permissions
    // recognise the new user. Without this, a newly-added team member could
    // pass the OAuth callback but /me would return team=null/role=member and
    // their Home view would be empty. ON CONFLICT is a safety net — if a
    // members row already exists (e.g. re-adding a previously-removed user),
    // we leave the auth table alone.
    try {
      await query(
        `INSERT INTO members (name, initials, role, team, region, country, email, avatar_url, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
         ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             initials = EXCLUDED.initials,
             role = EXCLUDED.role,
             team = EXCLUDED.team,
             region = EXCLUDED.region,
             country = EXCLUDED.country,
             avatar_url = EXCLUDED.avatar_url,
             is_active = true,
             updated_at = NOW()`,
        [name, initials, access, team, region, country, email, avatarUrl]
      );
    } catch (memErr) {
      console.warn('[team-members POST] members seed failed:', memErr.message);
    }

    // Flush the server-side roster cache + rehydrate now so the next scoped
    // request (queue / tasks / escalations) sees the new person without
    // waiting for the 5s TTL to expire.
    invalidateRosterCache();
    await ensureRosterHydrated({ force: true });

    return NextResponse.json({
      email, name, initials, title, access, managerEmail, team, region,
      service, country, avatarUrl, startDate,
      isNew: true, isDeleted: false, onLeave: false,
      lastSeenAt: null, lastLoginAt: null, loginCount: 0,
      orgNodeId,
    }, { status: 201 });
  } catch (err) {
    console.error('[team-members POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
